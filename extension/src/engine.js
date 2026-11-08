import { DEFAULT_SETTINGS, groupLabel, groupTitle, planGroups, resolveOwnership, siteForTab } from "./sites.js";
import { coverPresentation, coverUrl, iconRevision, readCover } from "./covers.js";
import { customGroupIds } from "./custom.js";

export function createEngine(api) {
  const coverBase = api.runtime?.getURL("cover.html");
  async function settings() {
    const saved = await api.storage.local.get("settings");
    return { ...DEFAULT_SETTINGS, ...saved.settings };
  }

  async function context(windowId) {
    const window = await api.windows.get(windowId);
    if (window.type !== "normal" || window.incognito) throw new Error("Use Stacks in a regular Chrome window.");
    const [tabs, groups, session, local, recovery] = await Promise.all([
      api.tabs.query({ windowId }), api.tabGroups.query({ windowId }),
      api.storage.session.get("ownedGroups"), api.storage.local.get("knownSites"),
      api.storage.local.get("groupRecovery"),
    ]);
    const owned = resolveOwnership(tabs, groups, session.ownedGroups, local.knownSites, coverBase);
    const custom = await customGroupIds(api, groups, tabs);
    for (const group of groups) {
      if (custom.has(group.id)) { delete owned[group.id]; continue; }
      const saved = recovery.groupRecovery?.[group.id];
      if (owned[group.id] || session.ownedGroups?.[group.id] || group.shared || !saved
        || saved.windowId !== windowId || saved.title !== group.title) continue;
      const members = tabs.filter(tab => tab.groupId === group.id);
      if (members.length && members.every(tab => saved.memberIds.includes(tab.id) && siteForTab(tab)?.key === saved.key)) {
        owned[group.id] = { ...saved.owner };
        delete owned[group.id].coverId;
      }
    }
    return { tabs, groups, owned, session: session.ownedGroups || {}, knownSites: local.knownSites || {} };
  }

  async function reconcile(windowId, force = false) {
    const prefs = await settings();
    if (!force && !prefs.autoGroup) return refreshAppearance(windowId);
    const ctx = await context(windowId);
    const plan = planGroups(ctx.tabs, ctx.owned);
    // Persist only ownership, never page URLs or titles.
    Object.assign(ctx.session, ctx.owned);
    if (plan.detach.length) await api.tabs.ungroup(plan.detach);
    for (const bucket of plan.buckets) {
      const ids = bucket.tabs.filter(tab => tab.groupId !== bucket.groupId).map(tab => tab.id);
      let id = bucket.groupId;
      if (id === null) {
        // Write the recovery marker first so interruption after group creation
        // can be recovered when Chrome next wakes the service worker.
        const title = groupTitle(bucket.site, bucket.tabs.length);
        ctx.knownSites[groupLabel(bucket.site)] = bucket.site.key;
        await api.storage.local.set({ knownSites: ctx.knownSites });
        id = await api.tabs.group({ tabIds: ids, createProperties: { windowId } });
        await api.tabGroups.update(id, { title, color: bucket.tabs.some(tab => tab.active) ? "blue" : "grey" });
        ctx.session[id] = { key: bucket.site.key, title };
        await api.storage.session.set({ ownedGroups: ctx.session });
        // Keep the active tab visible and never switch focus to collapse it.
        if (prefs.collapseNew) {
          const members = await api.tabs.query({ groupId: id });
          if (!members.some(tab => tab.active)) await api.tabGroups.update(id, { collapsed: true });
        }
      } else if (ids.length) {
        await api.tabs.group({ tabIds: ids, groupId: id });
      }
    }
    await api.storage.session.set({ ownedGroups: ctx.session });
    await refreshAppearance(windowId);
  }

  async function removeCover(owner) {
    if (!Number.isInteger(owner.coverId)) return;
    const tab = await api.tabs.get(owner.coverId).catch(() => null);
    if (tab && readCover(tab, coverBase)?.token === owner.coverToken) await api.tabs.remove(tab.id);
  }

  async function ensureCover(ctx, group, owner, members) {
    if (!coverBase || owner.coverDismissed) return null;
    let cover = owner.coverToken ? ctx.tabs.find(tab => readCover(tab, coverBase)?.token === owner.coverToken) : null;
    if (!cover && Number.isInteger(owner.coverId)) {
      // A closed, navigated or moved cover is user intent. Keep the real pages.
      owner.coverDismissed = true;
      delete owner.coverId;
      delete owner.coverToken;
      return null;
    }
    if (cover?.pinned || (cover && cover.groupId !== -1)) {
      owner.coverDismissed = true;
      delete owner.coverId;
      delete owner.coverToken;
      return null;
    }
    if (!cover) {
      owner.coverToken ||= crypto.randomUUID();
      ctx.session[group.id] = owner;
      await api.storage.session.set({ ownedGroups: ctx.session });
      // Earlier covers shift indices. Read the live boundary before inserting;
      // Chrome can inherit the neighbouring group for a newly inserted tab.
      const liveMembers = (await api.tabs.query({ groupId: group.id })).sort((a, b) => a.index - b.index);
      cover = await api.tabs.create({ windowId: group.windowId, active: false, index: liveMembers[0].index, url: coverUrl(coverBase, owner.key, owner.coverToken) });
      if (cover.groupId !== -1) await api.tabs.ungroup([cover.id]);
    }
    owner.coverId = cover.id;
    // Keep only our synthetic entry adjacent; never reorder a user's other groups.
    const current = await api.tabs.get(cover.id);
    const first = (await api.tabs.query({ groupId: group.id })).sort((a, b) => a.index - b.index)[0];
    if (first && current.index !== first.index - 1) {
      await api.tabs.move(cover.id, { index: first.index - (current.index < first.index ? 1 : 0) });
      if ((await api.tabs.get(cover.id)).groupId !== -1) await api.tabs.ungroup([cover.id]);
    }
    return cover;
  }

  // Updates preserve the native groups and their expanded state. Optional cover
  // tabs are the only additional tabs; actual conversations are never replaced.
  async function refreshAppearance(windowId) {
    const [ctx, prefs] = await Promise.all([context(windowId), settings()]);
    for (const group of ctx.groups) {
      const owner = ctx.owned[group.id];
      if (!owner) continue;
      const members = ctx.tabs.filter(tab => tab.groupId === group.id).sort((a, b) => a.index - b.index);
      if (!members.length) continue;
      const site = siteForTab({ url: `https://${owner.key}` });
      let cover;
      if (prefs.iconCovers) cover = await ensureCover(ctx, group, owner, members);
      const title = cover ? "" : groupTitle(site, members.length);
      const color = cover ? "blue" : members.some(tab => tab.active) ? "blue" : "grey";
      const label = groupLabel(site);
      if (ctx.knownSites[label] !== owner.key) {
        ctx.knownSites[label] = owner.key;
        await api.storage.local.set({ knownSites: ctx.knownSites });
      }
      if (group.title !== title) {
        // Recognize either title if Chrome suspends the worker during a rename.
        ctx.session[group.id] = { ...owner, nextTitle: title };
        await api.storage.session.set({ ownedGroups: ctx.session });
      }
      if (group.title !== title || group.color !== color) {
        await api.tabGroups.update(group.id, { title, color });
      }
      const active = members.find(tab => tab.active);
      if (active) owner.lastTabId = active.id;
      owner.windowId = windowId;
      // Revision signals favicon/count/fold changes to the cover page, without
      // persisting conversation URLs, titles, or favicon URLs.
      owner.count = members.length;
      owner.collapsed = group.collapsed;
      owner.iconRevision = iconRevision(members);
      ctx.session[group.id] = { ...owner, title };
      if (!prefs.iconCovers && owner.coverToken) {
        await removeCover(owner);
        delete ctx.session[group.id].coverId;
        delete ctx.session[group.id].coverToken;
      }
      if (!prefs.iconCovers) delete ctx.session[group.id].coverDismissed;
    }
    const live = new Set((await api.tabGroups.query({})).map(group => String(group.id)));
    for (const [id, owner] of Object.entries(ctx.session)) {
      const group = ctx.groups.find(item => item.id === Number(id));
      if (!live.has(id) || (group && !ctx.owned[id])) {
        await removeCover(owner);
        if (!live.has(id)) delete ctx.session[id];
        else { delete owner.coverId; delete owner.coverToken; owner.coverDismissed = true; }
      }
    }
    await api.storage.session.set({ ownedGroups: ctx.session });
    const saved = (await api.storage.local.get("groupRecovery")).groupRecovery || {};
    for (const group of ctx.groups) delete saved[group.id];
    for (const group of ctx.groups.filter(group => ctx.owned[group.id])) {
      const owner = ctx.session[group.id];
      if (!owner) continue;
      saved[group.id] = {
        windowId, title: owner.title, key: owner.key, owner,
        memberIds: ctx.tabs.filter(tab => tab.groupId === group.id).map(tab => tab.id),
      };
    }
    for (const id of Object.keys(saved)) if (!live.has(id)) delete saved[id];
    await api.storage.local.set({ groupRecovery: saved });
  }

  async function repairCover(tabId) {
    const tab = await api.tabs.get(tabId);
    const ctx = await context(tab.windowId);
    const group = ctx.groups.find(group => group.id === tab.groupId);
    const members = ctx.tabs.filter(member => member.groupId === tab.groupId);
    const site = siteForTab(tab);
    if (!group || group.shared || !site || (group.title && !ctx.owned[group.id])
      || !members.every(member => siteForTab(member)?.key === site.key)) {
      throw new Error("Select a webpage in a website stack first.");
    }
    const owner = { ...ctx.owned[group.id], key: site.key, title: group.title, preserveGroup: true };
    const existing = ctx.tabs.find(member => member.id === owner.coverId);
    if (!existing || readCover(existing, coverBase)?.token !== owner.coverToken) delete owner.coverId;
    delete owner.coverDismissed;
    ctx.session[group.id] = owner;
    await api.storage.session.set({ ownedGroups: ctx.session });
    await refreshAppearance(tab.windowId);
  }

  async function coverState(tabId) {
    const tab = await api.tabs.get(tabId);
    const cover = readCover(tab, coverBase);
    if (!cover) return { ok: false };
    const ctx = await context(tab.windowId);
    const entry = Object.entries(ctx.owned).find(([, owner]) => owner.coverId === tab.id && owner.coverToken === cover.token);
    if (!entry) return { ok: false };
    const group = ctx.groups.find(group => group.id === Number(entry[0]));
    const members = ctx.tabs.filter(member => member.groupId === group.id);
    return coverPresentation(api, siteForTab({ url: `https://${cover.key}/` }), members, group.collapsed);
  }

  async function activate(tabId, openOnly = false) {
    const tab = await api.tabs.get(tabId);
    const cover = readCover(tab, coverBase);
    if (!cover) {
      const saved = await api.storage.session.get("lastRealTabs");
      await api.storage.session.set({ lastRealTabs: { ...saved.lastRealTabs, [tab.windowId]: tabId } });
      return false;
    }
    const ctx = await context(tab.windowId);
    const entry = Object.entries(ctx.owned).find(([, owner]) => owner.coverId === tabId && owner.coverToken === cover.token);
    if (!entry) return false;
    const [id, owner] = entry;
    const group = ctx.groups.find(group => group.id === Number(id));
    const members = ctx.tabs.filter(member => member.groupId === group.id);
    if (!members.length) return false;
    if (group.collapsed || openOnly) {
      await api.tabGroups.update(group.id, { collapsed: false });
      const target = members.find(member => member.id === owner.lastTabId) || members[0];
      await api.tabs.update(target.id, { active: true });
    } else {
      const saved = await api.storage.session.get("lastRealTabs");
      const previous = saved.lastRealTabs?.[tab.windowId];
      const outside = ctx.tabs.filter(candidate => candidate.groupId !== group.id && !readCover(candidate, coverBase));
      const target = outside.find(candidate => candidate.id === previous) || outside.find(candidate => candidate.groupId === -1) || outside[0];
      await api.tabGroups.update(group.id, { collapsed: true });
      if (target) {
        if (target.groupId !== -1) await api.tabGroups.update(target.groupId, { collapsed: false });
        await api.tabs.update(target.id, { active: true });
      }
      // With no other real page to focus, the cover stays selected and provides
      // an accessible "open" button; Chrome emits no click event on an active tab.
    }
    await refreshAppearance(tab.windowId);
    return true;
  }

  async function snapshot(windowId) {
    const [ctx, prefs] = await Promise.all([context(windowId), settings()]);
    const stacks = ctx.groups.filter(group => ctx.owned[group.id]).map(group => {
      const tabs = ctx.tabs.filter(tab => tab.groupId === group.id);
      const key = ctx.owned[group.id].key;
      const site = siteForTab({ url: `https://${key}` });
      return { ...site, id: group.id, collapsed: group.collapsed, color: group.color, tabs };
    }).sort((a, b) => (a.tabs[0]?.index ?? 0) - (b.tabs[0]?.index ?? 0));
    const loose = ctx.tabs.filter(tab => !ctx.owned[tab.groupId]);
    return { settings: prefs, stacks, loose, tabCount: ctx.tabs.length, windowId };
  }

  async function setSettings(patch) {
    const next = await settings();
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof patch[key] === "boolean") next[key] = patch[key];
    }
    await api.storage.local.set({ settings: next });
    return next;
  }

  async function collapse(windowId, groupId, collapsed) {
    const ctx = await context(windowId);
    const targets = ctx.groups.filter(group => ctx.owned[group.id] && (groupId === null || group.id === groupId));
    if (groupId !== null && !targets.length) throw new Error("This stack has changed. Refresh and try again.");
    let skipped = 0;
    for (const group of targets) {
      const members = await api.tabs.query({ groupId: group.id });
      if (collapsed && members.some(tab => tab.active)) { skipped++; continue; }
      await api.tabGroups.update(group.id, { collapsed });
    }
    return { skipped };
  }

  async function focus(windowId, tabId) {
    const tab = await api.tabs.get(tabId);
    if (tab.windowId !== windowId) throw new Error("This tab moved to another window. Refresh and try again.");
    if (tab.groupId !== -1) await api.tabGroups.update(tab.groupId, { collapsed: false });
    await api.tabs.update(tabId, { active: true });
  }

  async function release(windowId) {
    await setSettings({ autoGroup: false });
    const ctx = await context(windowId);
    const ids = ctx.tabs.filter(tab => ctx.owned[tab.groupId]).map(tab => tab.id);
    if (ids.length) await api.tabs.ungroup(ids);
    for (const [id, owner] of Object.entries(ctx.owned)) {
      await removeCover(owner);
      delete ctx.session[id];
    }
    await api.storage.session.set({ ownedGroups: ctx.session });
  }

  return { context, repairCover, settings, reconcile, refreshAppearance, coverState, activate, snapshot, setSettings, collapse, focus, release };
}
