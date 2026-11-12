import { createEngine } from "./engine.js";
import { createControls } from "./controls.js";
import { createCompactEngine } from "./compact.js";
import { readCover } from "./covers.js";
import { createFocusGuard } from "./focus.js";
import { createCustomManager } from "./custom.js";
import { createLibrary, snapshotFromState } from "./library.js";

const focusGuard = createFocusGuard();
const engine = createCompactEngine(chrome, createEngine(chrome), focusGuard);
const custom = createCustomManager(chrome, engine, focusGuard);
const library = createLibrary(chrome, custom, engine, focusGuard);
const timers = new Map();
const activations = new Map();
const removedTabs = new Set();
let queue = Promise.resolve();
// One mutation queue across all windows: concurrent events cannot duplicate
// groups or overwrite another window's ownership registry.
function serial(work) {
  const next = queue.then(work);
  queue = next.catch(error => console.warn("Stacks:", error.message));
  return next;
}
function schedule(windowId, regroup = true) {
  if (!Number.isInteger(windowId) || windowId < 0) return;
  const pending = timers.get(windowId);
  clearTimeout(pending?.timer);
  const shouldRegroup = regroup || pending?.regroup;
  const timer = setTimeout(() => {
    timers.delete(windowId);
    void serial(async () => {
      if (shouldRegroup) await engine.reconcile(windowId); else await engine.refreshAppearance(windowId);
      await library.safely(() => library.capture(windowId));
    }).catch(() => {});
  }, 300);
  timers.set(windowId, { timer, regroup: shouldRegroup });
}
async function scheduleAll() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  for (const window of windows) if (!window.incognito) schedule(window.id);
}
async function boot() {
  await serial(async () => {
    await library.safely(() => library.initialize());
    await engine.recoverAfterReload();
    const active = await chrome.tabs.query({ active: true });
    for (const tab of active) {
      if (!tab.incognito && !readCover(tab, chrome.runtime.getURL("cover.html"))
        && !tab.url?.startsWith(chrome.runtime.getURL("parking.html"))) await engine.activate(tab.id);
    }
  });
  await serial(() => controls.setupMenus());
  await chrome.alarms.create("stacks-reconcile", { periodInMinutes: 1 });
  await scheduleAll();
}

export const controls = createControls(chrome, engine, serial, scheduleAll);
chrome.action.onClicked.addListener(tab => { void controls.organize(tab); });
chrome.contextMenus.onClicked.addListener((info, tab) => { void controls.menu(info, tab); });

chrome.tabs.onCreated.addListener(tab => {
  void serial(() => library.safely(() => library.track(tab)));
  schedule(tab.windowId);
});
chrome.tabs.onActivated.addListener(info => {
  const previousTabId = activations.get(info.windowId)?.tabId;
  activations.set(info.windowId, { tabId: info.tabId, previousTabId, handled: focusGuard.has(info.windowId) });
  void serial(() => activateOnce(info.tabId)).catch(() => {});
  schedule(info.windowId, false);
});

async function activateOnce(tabId, openOnly = false) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) {
    if (readCover(tab, chrome.runtime.getURL("cover.html"))) return false;
    return engine.activate(tabId);
  }
  let activation = activations.get(tab.windowId);
  if (!activation || activation.tabId !== tabId) {
    activation = { tabId, handled: false };
    activations.set(tab.windowId, activation);
  }
  if (!openOnly && activation.handled) return false;
  activation.handled = true;
  if (!openOnly && readCover(tab, chrome.runtime.getURL("cover.html"))) {
    const saved = activation.previousTabId == null ? (await chrome.storage.session.get("lastRealTabs")).lastRealTabs?.[tab.windowId] : null;
    const previousId = activation.previousTabId ?? (removedTabs.has(saved) ? saved : null);
    if (previousId != null && previousId !== tabId) {
      const previous = await chrome.tabs.get(previousId).catch(() => null);
      // Closing the active page or dragging it to another window selects a
      // neighbouring cover automatically. Neither action requests expansion.
      if (!previous || previous.windowId !== tab.windowId) return false;
    }
  }
  try {
    const result = await engine.activate(tabId, openOnly);
    if (!result) activation.handled = false;
    return result;
  } catch (error) {
    activation.handled = false;
    throw error;
  }
}
chrome.tabs.onUpdated.addListener((_id, changes, tab) => {
  if (changes.url || changes.title || changes.status === "complete") void serial(() => library.safely(() => library.track(tab)));
  if (changes.url || changes.status === "complete" || "pinned" in changes) schedule(tab.windowId);
  else if ("groupId" in changes || "favIconUrl" in changes) schedule(tab.windowId, false);
});
chrome.tabGroups.onUpdated.addListener(group => {
  void serial(async () => {
    if (await engine.captureGroupStyle(group)) await scheduleAll();
  }).catch(() => {});
  schedule(group.windowId, false);
});
chrome.tabGroups.onMoved.addListener(group => schedule(group.windowId, false));
chrome.tabGroups.onRemoved.addListener(group => schedule(group.windowId, false));
chrome.tabs.onRemoved.addListener((id, info) => {
  void serial(() => library.safely(() => library.removed(id, info)));
  removedTabs.add(id);
  if (removedTabs.size > 128) removedTabs.delete(removedTabs.values().next().value);
  if (!info.isWindowClosing) schedule(info.windowId);
});
chrome.tabs.onAttached.addListener((_id, info) => schedule(info.newWindowId));
chrome.tabs.onDetached.addListener((_id, info) => schedule(info.oldWindowId));
chrome.windows.onRemoved.addListener(windowId => { void serial(() => library.safely(() => library.windowRemoved(windowId))); });
chrome.tabs.onMoved.addListener((_id, info) => schedule(info.windowId, false));
chrome.tabs.onReplaced.addListener(id => {
  void chrome.tabs.get(id).then(tab => schedule(tab.windowId)).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => { void boot().catch(console.warn); });
chrome.runtime.onStartup.addListener(() => { void boot().catch(console.warn); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "stacks-reconcile") void scheduleAll().catch(console.warn);
});

async function popupState(windowId, result = {}) {
  const state = await custom.state(windowId);
  return { ...state, library: await library.state(windowId), savableStacks: snapshotFromState(state).sections, message: result.message };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const handlers = sender.tab ? {
    "cover-state": () => engine.coverState(sender.tab.id),
    "cover-open": async () => ({ ok: await activateOnce(sender.tab.id, true) }),
    "cover-toggle": async () => ({ ok: await activateOnce(sender.tab.id) }),
    "parking-recover": () => engine.recoverParking(sender.tab.id),
  } : {};
  if (sender.url?.split("?")[0] === chrome.runtime.getURL("manager.html")) {
    // A toolbar popup has no sender.tab. It resolves its window on opening;
    // every edit still validates that source window and its eligible tabs.
    const windowId = message.windowId;
    if (!Number.isInteger(windowId)) return;
    Object.assign(handlers, {
      "custom-state": async () => { await library.safely(() => library.capture(windowId)); return popupState(windowId); },
      "custom-create": () => library.mutate(windowId, "Create custom stack", message.tabIds, () => custom.create(windowId, message.name, message.color, message.tabIds)),
      "custom-assign": () => library.mutate(windowId, "Move tabs", message.tabIds, () => custom.assign(windowId, message.categoryId, message.tabIds)),
      "custom-rename": () => custom.rename(windowId, message.categoryId, message.name, message.color),
      "custom-release": () => library.mutate(windowId, "Return to automatic", message.tabIds, () => custom.release(windowId, message.tabIds)),
      "custom-remove": () => custom.remove(windowId, message.categoryId),
      "custom-organize": async () => {
        await engine.reconcile(windowId, true);
        await engine.collapse(windowId, null, true);
        return custom.state(windowId);
      },
      "library-save": () => library.saveStack(windowId, message.stackKey, message.name, message.closeTabs, message.expected),
      "library-restore": () => library.restore(windowId, message.kind, message.id),
      "library-backup": async () => { await library.backupNow(windowId); return { message: "Window backed up locally." }; },
      "library-toggle": async () => { await library.settings(message.enabled); await scheduleAll(); },
      "library-remove": () => library.remove(message.kind, message.id),
      "library-undo": () => library.undo(windowId),
    });
    for (const type of Object.keys(handlers).filter(type => type.startsWith("custom-") || type.startsWith("library-"))) {
      if (type === "custom-state") continue;
      const handler = handlers[type];
      handlers[type] = async () => {
        const result = await handler();
        await library.safely(() => library.capture(windowId));
        return popupState(windowId, result);
      };
    }
  }
  if (!Object.hasOwn(handlers, message?.type)) return;
  const work = handlers[message.type];
  void serial(work).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

