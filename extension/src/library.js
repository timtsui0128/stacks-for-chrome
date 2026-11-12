import { GROUP_COLORS } from "./styles.js";
import { isAuthenticationUrl, siteForUrl } from "./sites.js";

export const LIBRARY_KEY = "stackLibrary";
export const MAX_BACKUPS = 20;
const MAX_BYTES = 6 * 1024 * 1024;
const UNDO_KEY = "stackUndo";
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const count = entry => entry.sections.reduce((sum, section) => sum + section.tabs.length, 0);
const fingerprint = entry => JSON.stringify(entry.sections.map(({ tabs, ...section }) => ({
  ...section, tabs: tabs.map(({ url, title }) => ({ url, title })),
})));

// Save ordinary web links only. Never persist login-provider redirects,
// embedded credentials, browser pages, extension controls or local files.
export function restorableUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      && !isAuthenticationUrl(value) ? url.href : null;
  } catch { return null; }
}

export function snapshotFromState(state) {
  const sections = new Map();
  for (const tab of state.tabs) {
    const url = restorableUrl(tab.url);
    if (!url) continue;
    const category = state.categories.find(item => item.id === tab.categoryId);
    const site = siteForUrl(url);
    const website = state.websites?.find(item => item.key === site.key);
    const key = category ? `custom:${category.id}` : `website:${site.key}`;
    if (!sections.has(key)) sections.set(key, {
      key, kind: category ? "custom" : "website", categoryId: category?.id || null,
      siteKey: category ? null : site.key,
      name: category?.name || website?.name || site.name,
      label: category?.name || website?.label || site.name,
      color: category?.color || website?.color || site.color, tabs: [],
    });
    sections.get(key).tabs.push({ id: tab.id, url, title: (tab.title || url).slice(0, 1000) });
  }
  return { windowId: state.windowId, sections: [...sections.values()] };
}

// All callers run on background.js's mutation queue. A single atomic local
// record makes save-before-close durable even if the popup or worker disappears.
export function createLibrary(api, custom, engine, focusGuard) {
  let notice = "";
  const recentClosures = new Map();
  async function load() {
    const stored = (await api.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY];
    return { version: 1, enabled: true, saved: [], backups: [], current: {}, ...stored };
  }
  async function persist(data) {
    data.backups = data.backups.slice(0, MAX_BACKUPS);
    while (bytes(data) > MAX_BYTES && data.backups.length > 1) data.backups.pop();
    if (bytes(data) > MAX_BYTES) throw new Error("Local storage is full. Remove saved stacks or backups, then try again. Your open tabs have not been closed.");
    await api.storage.local.set({ [LIBRARY_KEY]: data });
    notice = "";
  }
  function backup(data, snapshot, reason) {
    if (!count(snapshot)) return;
    const signature = fingerprint(snapshot);
    const previous = data.backups.find(item => item.windowId === snapshot.windowId);
    if (previous && fingerprint(previous) === signature) return previous;
    const item = { ...structuredClone(snapshot), id: crypto.randomUUID(), name: reason, createdAt: Date.now() };
    data.backups.unshift(item);
    return item;
  }
  async function initialize() {
    const session = await api.storage.session.get("librarySessionStarted");
    if (session.librarySessionStarted) return;
    const data = await load();
    for (const snapshot of Object.values(data.current)) backup(data, snapshot, "Previous session");
    data.current = {};
    await persist(data);
    await api.storage.session.set({ librarySessionStarted: true, [UNDO_KEY]: [] });
  }
  async function capture(windowId) {
    const data = await load();
    if (!data.enabled) return;
    let snapshot;
    try { snapshot = snapshotFromState(await custom.state(windowId)); }
    catch { return; } // A closed window or our parking window is not a source.
    const previous = data.current[windowId];
    if (previous && fingerprint(previous) === fingerprint(snapshot)) {
      // Tab IDs may have changed even when the saved links haven't.
      if (JSON.stringify(previous.sections) === JSON.stringify(snapshot.sections)) return;
    } else if (previous && Date.now() - (previous.checkpointAt || 0) >= 5 * 60 * 1000) {
      backup(data, previous, "Automatic backup");
      snapshot.checkpointAt = Date.now();
    }
    snapshot.checkpointAt ||= previous?.checkpointAt || Date.now();
    snapshot.updatedAt = Date.now();
    data.current[windowId] = snapshot;
    await persist(data);
  }
  // Tab events carry the last URL even when a page closes before a scheduled
  // reconciliation runs. Preserve it in the current recovery snapshot.
  async function track(tab) {
    if (tab.incognito || tab.pinned) return;
    const url = restorableUrl(tab.pendingUrl || tab.url);
    if (!url) return;
    const data = await load();
    if (!data.enabled) return;
    for (const snapshot of Object.values(data.current)) {
      for (const section of snapshot.sections) {
        const member = section.tabs.find(item => item.id === tab.id);
        if (member) {
          member.url = url; member.title = (tab.title || url).slice(0, 1000);
          snapshot.updatedAt = Date.now();
          await persist(data); return;
        }
      }
    }
    const window = await api.windows.get(tab.windowId).catch(() => null);
    if (!window || window.type !== "normal" || window.incognito) return;
    const windowTabs = await api.tabs.query({ windowId: tab.windowId });
    if (windowTabs.some(item => item.url?.startsWith(api.runtime.getURL("parking.html")))) return;
    const group = tab.groupId >= 0 ? await api.tabGroups.get(tab.groupId).catch(() => null) : null;
    if (group?.shared) return;
    // Existing native groups are classified through the normal snapshot path.
    if (group) { await capture(tab.windowId); return; }
    const site = siteForUrl(url);
    const snapshot = data.current[tab.windowId] ||= { windowId: tab.windowId, sections: [], checkpointAt: Date.now() };
    let section = snapshot.sections.find(item => item.kind === "website" && item.siteKey === site.key);
    if (!section) {
      section = { key: `website:${site.key}`, kind: "website", categoryId: null, siteKey: site.key,
        name: site.name, label: site.name, color: site.color, tabs: [] };
      snapshot.sections.push(section);
    }
    section.tabs.push({ id: tab.id, url, title: (tab.title || url).slice(0, 1000) });
    snapshot.updatedAt = Date.now();
    await persist(data);
  }
  async function removed(tabId, info) {
    const data = await load();
    if (!data.enabled) return;
    let changed = false;
    for (const [windowId, snapshot] of Object.entries(data.current)) {
      if (!snapshot.sections.some(section => section.tabs.some(tab => tab.id === tabId))) continue;
      // One pre-close snapshot for a burst of removals (e.g. Close group).
      const recent = recentClosures.get(windowId);
      if (!recent || Date.now() - recent > 1500) {
        backup(data, snapshot, info.isWindowClosing ? "Before window closed" : "Before tabs closed");
      }
      recentClosures.set(windowId, Date.now());
      for (const section of snapshot.sections) section.tabs = section.tabs.filter(tab => tab.id !== tabId);
      snapshot.sections = snapshot.sections.filter(section => section.tabs.length);
      if (!snapshot.sections.length) delete data.current[windowId];
      changed = true;
    }
    if (changed) await persist(data);
  }
  async function windowRemoved(windowId) {
    const data = await load();
    const snapshot = data.current[windowId];
    if (!snapshot) return;
    if (data.enabled) backup(data, snapshot, "Before window closed");
    delete data.current[windowId];
    await persist(data);
  }
  async function state(windowId) {
    const data = await load();
    const undo = (await api.storage.session.get(UNDO_KEY))[UNDO_KEY] || [];
    return { ok: true, enabled: data.enabled, saved: data.saved, backups: data.backups,
      undo: undo.find(item => item.windowId === windowId) || null, notice };
  }
  async function saveStack(windowId, key, name, closeTabs = false, expected = []) {
    const snapshot = snapshotFromState(await custom.state(windowId));
    const section = snapshot.sections.find(item => item.key === key);
    name = typeof name === "string" ? name.trim() : "";
    if (!section?.tabs.length) throw new Error("This stack has no savable webpages. Refresh and try again.");
    if (!name || name.length > 80) throw new Error("Enter a name between 1 and 80 characters.");
    if (closeTabs && JSON.stringify(section.tabs.map(({ id, url }) => ({ id, url }))) !== JSON.stringify(expected)) {
      throw new Error("The stack changed. Close this dialog and review its pages before saving and closing.");
    }
    const data = await load();
    const saved = { id: crypto.randomUUID(), name, createdAt: Date.now(), sections: [structuredClone(section)] };
    // A saved custom stack uses the chosen name when it is reopened.
    if (section.kind === "custom") saved.sections[0].name = saved.sections[0].label = name;
    data.saved.unshift(saved);
    await persist(data); // No tabs.remove can run before this succeeds.
    if (closeTabs) {
      try {
        const latest = snapshotFromState(await custom.state(windowId)).sections.find(item => item.key === key);
        if (!latest || JSON.stringify(latest.tabs.map(({ id, url }) => ({ id, url }))) !== JSON.stringify(expected)) {
          return { saved: true, message: "Saved. The stack changed, so its pages were kept open." };
        }
        const live = await Promise.all(section.tabs.map(tab => api.tabs.get(tab.id).catch(() => null)));
        if (live.some((tab, i) => !tab || tab.pinned || (tab.pendingUrl || tab.url) !== section.tabs[i].url)) {
          return { saved: true, message: "Saved. The stack changed, so its pages were kept open." };
        }
        await focusGuard.run(windowId, async () => {
          // Leave a normal tab if closing the last real pages in this window.
          const pages = await api.tabs.query({ windowId });
          const ids = new Set(section.tabs.map(tab => tab.id));
          if (pages.every(tab => ids.has(tab.id) || tab.url?.startsWith(api.runtime.getURL("")))) {
            await api.tabs.create({ windowId, active: true, url: "chrome://newtab/" });
          }
          await api.tabs.remove([...ids]);
        });
      } catch { return { saved: true, message: "Saved. Some pages could not be closed; check your open tabs." }; }
    }
    return { saved: true, message: closeTabs ? "Stack saved. Pages closed." : "Stack saved. Pages kept open." };
  }
  async function backupNow(windowId) {
    const snapshot = snapshotFromState(await custom.state(windowId));
    if (!count(snapshot)) throw new Error("There are no savable webpages in this window.");
    const data = await load(); backup(data, snapshot, "Manual backup"); await persist(data);
  }
  async function settings(enabled) {
    const data = await load(); data.enabled = !!enabled;
    if (!enabled) data.current = {};
    await persist(data);
  }
  async function remove(kind, id) {
    if (!["saved", "backups"].includes(kind)) throw new Error("Unknown library section.");
    const data = await load(); data[kind] = data[kind].filter(item => item.id !== id); await persist(data);
  }
  async function restore(windowId, kind, id) {
    if (!["saved", "backups"].includes(kind)) throw new Error("Unknown library section.");
    const data = await load();
    const entry = data[kind].find(item => item.id === id);
    if (!entry) throw new Error("This saved item no longer exists.");
    await engine.context(windowId); // Validate normal, non-incognito destination.
    const managed = await custom.state(windowId);
    const candidates = new Map();
    const live = new Map([...await api.tabs.query({ windowId }), ...managed.tabs].map(tab => [tab.id, tab]));
    for (const tab of live.values()) {
      const url = restorableUrl(tab.pendingUrl || tab.url);
      if (url) candidates.set(url, (candidates.get(url) || 0) + 1);
    }
    let opened = 0, skipped = 0;
    await focusGuard.run(windowId, async () => {
      for (const section of entry.sections) {
        const created = [];
        try {
          for (const tab of section.tabs) {
            const url = restorableUrl(tab.url);
            if (!url) { skipped++; continue; }
            if (candidates.get(url) > 0) { candidates.set(url, candidates.get(url) - 1); skipped++; continue; }
            const fresh = await api.tabs.create({ windowId, url, active: false });
            created.push(fresh.id); opened++;
            if (fresh.groupId >= 0) await api.tabs.ungroup([fresh.id]);
          }
        } finally {
          // Protect restored custom members from automatic regrouping even if
          // creating a later tab failed. Keep the saved copy for a safe retry.
          if (created.length && section.kind === "custom") {
            await custom.restore(windowId, { ...section, color: GROUP_COLORS.includes(section.color) ? section.color : "grey" }, created);
          }
        }
      }
      // Existing tabs and global website styles remain authoritative.
      await engine.reconcile(windowId);
    });
    await capture(windowId);
    return { opened, skipped, message: opened
      ? `Opened ${opened} ${opened === 1 ? "page" : "pages"}.${skipped ? ` ${skipped} already open or unavailable.` : ""}`
      : "These pages are already open in this window." };
  }
  async function mutate(windowId, label, tabIds, work) {
    const before = await custom.state(windowId);
    const selected = before.tabs.filter(tab => tabIds?.includes(tab.id));
    if (!selected.length) return work();
    const data = await load();
    if (data.enabled) { backup(data, snapshotFromState(before), "Before organizing tabs"); await persist(data); }
    try { return await work(); }
    finally {
      const after = await custom.state(windowId);
      const items = selected.map(tab => ({ id: tab.id,
        before: before.categories.find(category => category.id === tab.categoryId) || null,
        after: after.tabs.find(item => item.id === tab.id)?.categoryId || null,
      })).filter(item => (item.before?.id || null) !== item.after);
      if (items.length) {
        const undo = (await api.storage.session.get(UNDO_KEY))[UNDO_KEY] || [];
        undo.unshift({ id: crypto.randomUUID(), windowId, label, items });
        await api.storage.session.set({ [UNDO_KEY]: undo.slice(0, 10) });
      }
    }
  }
  async function undo(windowId) {
    const history = (await api.storage.session.get(UNDO_KEY))[UNDO_KEY] || [];
    const entry = history.find(item => item.windowId === windowId);
    if (!entry) throw new Error("There is no move to undo in this window.");
    const current = await custom.state(windowId);
    const items = entry.items.filter(item => current.tabs.some(tab => tab.id === item.id));
    if (items.some(item => current.tabs.find(tab => tab.id === item.id).categoryId !== item.after)) {
      await api.storage.session.set({ [UNDO_KEY]: history.filter(item => item.id !== entry.id) });
      throw new Error("Those tabs were reorganized since this move. Their current groups were kept.");
    }
    await focusGuard.run(windowId, async () => {
      const automatic = items.filter(item => !item.before).map(item => item.id);
      if (automatic.length) await custom.release(windowId, automatic);
      for (const category of new Map(items.filter(item => item.before).map(item => [item.before.id, item.before])).values()) {
        const ids = items.filter(item => item.before?.id === category.id).map(item => item.id);
        if (current.categories.some(item => item.id === category.id)) await custom.assign(windowId, category.id, ids);
        else await custom.create(windowId, category.name, category.color, ids);
      }
    });
    await api.storage.session.set({ [UNDO_KEY]: history.filter(item => item.id !== entry.id) });
    await capture(windowId);
    return { message: items.length ? "Move undone. The same pages are still open." : "Those pages have closed. Use Backups to reopen their links." };
  }
  async function safely(work) {
    try { await work(); }
    catch (error) { notice = `Backup paused: ${error.message}`; console.warn("Stacks backup:", error.message); }
  }
  return { initialize, capture, track, removed, windowRemoved, state, saveStack, backupNow, settings, remove, restore, mutate, undo, safely };
}
