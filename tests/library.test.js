import test from "node:test";
import assert from "node:assert/strict";
import { createLibrary, restorableUrl, LIBRARY_KEY, MAX_BACKUPS } from "../extension/src/library.js";

function fixture() {
  const local = {}, session = {}, removed = [], created = [];
  let failStorage = false, nextId = 100;
  let tabs = [
    { id: 1, windowId: 1, groupId: 20, url: "https://example.com/a", title: "Paper A", categoryId: "research" },
    { id: 2, windowId: 1, groupId: 20, url: "https://example.org/b", title: "Paper B", categoryId: "research" },
  ];
  const categories = [{ id: "research", name: "Research", color: "purple" }, { id: "later", name: "Later", color: "green" }];
  const area = data => ({
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(data[key])])),
    set: async patch => { if (data === local && failStorage) throw new Error("QUOTA_BYTES exceeded"); Object.assign(data, structuredClone(patch)); },
  });
  const api = {
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    storage: { local: area(local), session: area(session) },
    windows: { get: async id => ({ id, type: "normal", incognito: false }) },
    tabs: {
      query: async ({ windowId } = {}) => structuredClone(tabs.filter(tab => windowId == null || tab.windowId === windowId)),
      get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error("closed"); return structuredClone(tab); },
      create: async properties => { const tab = { id: nextId++, groupId: -1, categoryId: null, title: "Restored", ...properties }; tabs.push(tab); created.push(tab); return structuredClone(tab); },
      remove: async ids => { assert.ok(local[LIBRARY_KEY]?.saved.length, "save must be durable before close"); removed.push(...ids); tabs = tabs.filter(tab => !ids.includes(tab.id)); },
      ungroup: async ids => { tabs.filter(tab => ids.includes(tab.id)).forEach(tab => { tab.groupId = -1; }); },
    },
    tabGroups: { get: async () => ({ shared: false }) },
  };
  const custom = {
    state: async windowId => ({ ok: true, windowId, tabs: structuredClone(tabs.filter(tab => tab.windowId === windowId)), categories: structuredClone(categories), websites: [] }),
    assign: async (_windowId, categoryId, ids) => { tabs.filter(tab => ids.includes(tab.id)).forEach(tab => { tab.categoryId = categoryId; }); },
    release: async (_windowId, ids) => { tabs.filter(tab => ids.includes(tab.id)).forEach(tab => { tab.categoryId = null; }); },
    create: async (_windowId, name, color, ids) => { const category = { id: String(nextId++), name, color }; categories.push(category); tabs.filter(tab => ids.includes(tab.id)).forEach(tab => { tab.categoryId = category.id; }); },
    restore: async (windowId, saved, ids) => {
      const existing = categories.find(item => item.id === saved.categoryId && item.name === saved.name && item.color === saved.color);
      if (existing) await custom.assign(windowId, existing.id, ids); else await custom.create(windowId, saved.name, saved.color, ids);
    },
  };
  const engine = { context: async () => {}, reconcile: async () => {} };
  const guard = { run: async (_id, work) => work() };
  const library = createLibrary(api, custom, engine, guard);
  return { library, api, custom, local, session, removed, created, categories,
    tabs: () => tabs, setTabs: value => { tabs = value; }, failStorage: () => { failStorage = true; },
    restart: () => createLibrary(api, custom, engine, guard) };
}

test("saved links exclude browser pages, local files, credentials and sign-in redirects", () => {
  for (const url of ["chrome://settings", "file:///paper.pdf", "javascript:alert(1)", "data:text/html,x", "https://user:secret@example.com/", "https://accounts.google.com/signin", "not a URL"]) assert.equal(restorableUrl(url), null);
  assert.equal(restorableUrl("https://example.com/paper?id=1#results"), "https://example.com/paper?id=1#results");
});

test("saving a stack preserves links, order and custom color without closing pages", async () => {
  const f = fixture();
  await f.library.saveStack(1, "custom:research", "Thesis references");
  const saved = (await f.library.state(1)).saved[0];
  assert.equal(saved.name, "Thesis references");
  assert.equal(saved.sections[0].color, "purple");
  assert.deepEqual(saved.sections[0].tabs.map(tab => tab.url), f.tabs().map(tab => tab.url));
  assert.equal(f.removed.length, 0);
  assert.equal((await f.restart().state(1)).saved.length, 1);
});

test("save-and-close never closes a tab after a failed durable write", async () => {
  const f = fixture(); f.failStorage();
  const expected = f.tabs().map(({ id, url }) => ({ id, url }));
  await assert.rejects(f.library.saveStack(1, "custom:research", "Research", true, expected), /QUOTA_BYTES/);
  assert.equal(f.removed.length, 0); assert.equal(f.tabs().length, 2);
});

test("a stale save-and-close preview cannot close newly added or navigated tabs", async () => {
  const f = fixture();
  const expected = f.tabs().map(({ id, url }) => ({ id, url }));
  f.tabs()[0].url = "https://example.com/changed";
  await assert.rejects(f.library.saveStack(1, "custom:research", "Research", true, expected), /stack changed/);
  assert.equal(f.removed.length, 0);
});

test("save-and-close writes first, then restores only missing pages and keeps custom ownership", async () => {
  const f = fixture();
  const expected = f.tabs().map(({ id, url }) => ({ id, url }));
  await f.library.saveStack(1, "custom:research", "Research", true, expected);
  assert.deepEqual(f.removed, [1, 2]);
  const saved = (await f.library.state(1)).saved[0];
  f.setTabs([{ id: 9, windowId: 1, url: expected[0].url, categoryId: "later" }]);
  const result = await f.library.restore(1, "saved", saved.id);
  assert.equal(result.opened, 1); assert.equal(result.skipped, 1);
  assert.equal(f.tabs().find(tab => tab.id === 9).categoryId, "later", "existing tabs must not be stolen");
  assert.equal(f.created.find(tab => tab.url === expected[1].url).categoryId, "research");
  assert.equal((await f.library.restore(1, "saved", saved.id)).opened, 0);
  assert.equal((await f.library.state(1)).saved.length, 1);
});

test("restore preserves intentional duplicates by counting existing matching URLs", async () => {
  const f = fixture(); f.tabs()[1].url = f.tabs()[0].url;
  await f.library.saveStack(1, "custom:research", "Research");
  const saved = (await f.library.state(1)).saved[0]; f.setTabs([f.tabs()[0]]);
  assert.equal((await f.library.restore(1, "saved", saved.id)).opened, 1);
  assert.equal((await f.library.restore(1, "saved", saved.id)).opened, 0);
});

test("a burst of window-close events preserves the whole pre-close snapshot", async () => {
  const f = fixture(); await f.library.capture(1);
  f.setTabs([]);
  await f.library.removed(1, { windowId: 1, isWindowClosing: true });
  await f.library.removed(2, { windowId: 1, isWindowClosing: true });
  const backups = (await f.restart().state(1)).backups;
  assert.equal(backups.length, 1); assert.equal(backups[0].name, "Before window closed");
  assert.equal(backups[0].sections[0].tabs.length, 2);
  assert.equal((await f.library.restore(1, "backups", backups[0].id)).opened, 2);
});

test("backups are bounded, saved stacks survive pruning and turning backups off", async () => {
  const f = fixture(); await f.library.saveStack(1, "custom:research", "Research");
  for (let i = 0; i < MAX_BACKUPS + 3; i++) { f.tabs()[0].title = `Revision ${i}`; await f.library.backupNow(1); }
  assert.equal((await f.library.state(1)).backups.length, MAX_BACKUPS);
  await f.library.settings(false); await f.library.capture(1); await f.library.removed(1, { isWindowClosing: false });
  assert.equal((await f.library.state(1)).saved.length, 1);
  assert.deepEqual(f.local[LIBRARY_KEY].current, {});
});

test("undo moves the same live pages back, including after a worker restart", async () => {
  const f = fixture();
  await f.library.mutate(1, "Move tabs", [1], () => f.custom.assign(1, "later", [1]));
  assert.equal(f.tabs()[0].categoryId, "later");
  await f.restart().undo(1);
  assert.equal(f.tabs()[0].categoryId, "research");
  assert.equal(f.tabs()[0].id, 1); assert.equal(f.created.length, 0); assert.equal(f.removed.length, 0);
  assert.equal((await f.library.state(1)).undo, null);
});

test("undo refuses to overwrite a subsequent manual regrouping", async () => {
  const f = fixture();
  await f.library.mutate(1, "Move tabs", [1], () => f.custom.assign(1, "later", [1]));
  f.tabs()[0].categoryId = null;
  await assert.rejects(f.library.undo(1), /reorganized/);
  assert.equal(f.tabs()[0].categoryId, null);
});

test("cold session archives the last durable snapshot before accepting new tab IDs", async () => {
  const f = fixture(); await f.library.capture(1); f.setTabs([]);
  await f.restart().initialize();
  assert.equal((await f.library.state(1)).backups[0].name, "Previous session");
  assert.deepEqual(f.local[LIBRARY_KEY].current, {});
});

test("closing a source window also backs up members that were parked elsewhere", async () => {
  const f = fixture(); await f.library.capture(1);
  // No eligible real-tab removal occurs in the source when all pages are parked.
  f.setTabs(f.tabs().map(tab => ({ ...tab, windowId: 2 })));
  await f.library.windowRemoved(1);
  const backups = (await f.library.state(1)).backups;
  assert.equal(backups[0].name, "Before window closed");
  assert.equal(backups[0].sections[0].tabs.length, 2);
  assert.deepEqual(f.local[LIBRARY_KEY].current, {});
});
