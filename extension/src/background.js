import { createEngine } from "./engine.js";
import { createControls } from "./controls.js";
import { createCompactEngine } from "./compact.js";
import { readCover } from "./covers.js";

const engine = createCompactEngine(chrome, createEngine(chrome));
const timers = new Map();
const activations = new Map();
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
    void serial(() => shouldRegroup ? engine.reconcile(windowId) : engine.refreshAppearance(windowId)).catch(() => {});
  }, 300);
  timers.set(windowId, { timer, regroup: shouldRegroup });
}
async function scheduleAll() {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  for (const window of windows) if (!window.incognito) schedule(window.id);
}
async function boot() {
  await serial(async () => {
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

chrome.tabs.onCreated.addListener(tab => schedule(tab.windowId));
chrome.tabs.onActivated.addListener(info => {
  activations.set(info.windowId, { tabId: info.tabId, handled: false });
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
chrome.tabs.onRemoved.addListener((_id, info) => { if (!info.isWindowClosing) schedule(info.windowId); });
chrome.tabs.onAttached.addListener((_id, info) => schedule(info.newWindowId));
chrome.tabs.onDetached.addListener((_id, info) => schedule(info.oldWindowId));
chrome.tabs.onReplaced.addListener(id => {
  void chrome.tabs.get(id).then(tab => schedule(tab.windowId)).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => { void boot().catch(console.warn); });
chrome.runtime.onStartup.addListener(() => { void boot().catch(console.warn); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "stacks-reconcile") void scheduleAll().catch(console.warn);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || sender.id !== chrome.runtime.id) return;
  const handlers = {
    "cover-state": () => engine.coverState(sender.tab.id),
    "cover-open": async () => ({ ok: await activateOnce(sender.tab.id, true) }),
    "cover-toggle": async () => ({ ok: await activateOnce(sender.tab.id) }),
    "parking-recover": () => engine.recoverParking(sender.tab.id),
  };
  if (!Object.hasOwn(handlers, message?.type)) return;
  const work = handlers[message.type];
  void serial(work).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

