import test from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../extension/src/engine.js";
import { siteForUrl, planGroups, resolveOwnership, isAuthenticationUrl } from "../extension/src/sites.js";
import { readCover, coverUrl } from "../extension/src/covers.js";

function mock(tabs = [], groups = [], local = {}, session = {}) {
  let next = 100;
  const mutations = [];
  const storage = data => ({
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async value => Object.assign(data, structuredClone(value)),
  });
  const clean = () => { for (let i = groups.length - 1; i >= 0; i--) if (!tabs.some(tab => tab.groupId === groups[i].id)) groups.splice(i, 1); };
  const api = {
    windows: { get: async id => ({ id, type: "normal", incognito: false }) },
    storage: { local: storage(local), session: storage(session) },
    tabs: {
      query: async query => structuredClone(tabs.filter(tab => Object.entries(query).every(([key, value]) => tab[key] === value))),
      get: async id => { const tab = tabs.find(tab => tab.id === id); if (!tab) throw new Error("Tab closed"); return structuredClone(tab); },
      group: async ({ tabIds, groupId, createProperties }) => {
        if (groupId === undefined) { groupId = next++; groups.push({ id: groupId, windowId: createProperties.windowId, title: "", color: "grey", collapsed: false }); }
        for (const id of tabIds) tabs.find(tab => tab.id === id).groupId = groupId;
        mutations.push(["group", tabIds]); clean(); return groupId;
      },
      ungroup: async ids => { for (const id of ids) tabs.find(tab => tab.id === id).groupId = -1; clean(); mutations.push(["ungroup", ids]); },
      update: async (id, patch) => { if (patch.active) for (const tab of tabs) tab.active = tab.id === id; Object.assign(tabs.find(tab => tab.id === id), patch); },
    },
    tabGroups: {
      query: async query => structuredClone(groups.filter(group => Object.entries(query).every(([key, value]) => group[key] === value))),
      update: async (id, patch) => { const group = groups.find(group => group.id === id); if (!group) throw new Error("Group closed"); Object.assign(group, patch); mutations.push(["update", id, patch]); return structuredClone(group); },
    },
  };
  return { api, engine: createEngine(api), tabs, groups, local, session, mutations };
}
function tab(id, url, patch = {}) { return { id, url, title: `Tab ${id}`, index: id - 1, windowId: 1, groupId: -1, pinned: false, active: false, ...patch }; }
const gpt = "https://chatgpt.com/c/one";
const claude = "https://claude.ai/chat/two";

test("authentication providers are recognized without accepting lookalike hosts", () => {
  assert.equal(isAuthenticationUrl("https://login.microsoftonline.com/tenant/saml2"), true);
  assert.equal(isAuthenticationUrl("https://accounts.google.com/ServiceLogin"), true);
  assert.equal(isAuthenticationUrl("https://login.canvas.manchester.ac.uk/login"), true);
  assert.equal(isAuthenticationUrl("https://login.microsoftonline.com.evil.example/login"), false);
  assert.equal(isAuthenticationUrl("https://example.com/login"), false);
  assert.equal(isAuthenticationUrl("http://login.microsoftonline.com/tenant/saml2"), false);
});

test("website matching keeps services and private subdomains separate", () => {
  assert.equal(siteForUrl("https://www.chatgpt.com/c/1").key, "chatgpt.com");
  assert.equal(siteForUrl("https://chat.openai.com/c/1").key, "chatgpt.com");
  assert.notEqual(siteForUrl("https://scholar.google.com").key, siteForUrl("https://docs.google.com").key);
  assert.notEqual(siteForUrl("https://a.github.io").key, siteForUrl("https://b.github.io").key);
  assert.equal(siteForUrl("chrome://settings"), null);
  assert.equal(siteForUrl("file:///paper.pdf"), null);
  assert.equal(siteForUrl("not a url"), null);
});

test("groups duplicate websites, preserves active tab, pins, manual groups and windows", async () => {
  const fixture = mock([
    tab(1, gpt, { active: true }), tab(2, gpt), tab(3, claude), tab(4, claude),
    tab(5, gpt, { pinned: true }), tab(6, gpt, { groupId: 50 }),
    tab(7, "chrome://extensions"), tab(8, "https://nature.com"), tab(9, gpt, { windowId: 2 }),
  ], [{ id: 50, windowId: 1, title: "My project", collapsed: false }]);
  await fixture.engine.reconcile(1);
  const state = await fixture.engine.snapshot(1);
  assert.equal(state.stacks.length, 2);
  assert.equal(state.stacks.find(stack => stack.key === "chatgpt.com").collapsed, false);
  assert.equal(state.stacks.find(stack => stack.key === "claude.ai").collapsed, true);
  assert.deepEqual(fixture.tabs.filter(tab => [5, 6, 7, 8, 9].includes(tab.id)).map(tab => tab.groupId), [-1, 50, -1, -1, -1]);
  assert.equal(fixture.tabs.find(tab => tab.active).id, 1);
  assert.equal(fixture.tabs.length, 9);
});

test("reconciliation is idempotent; new conversations join existing groups", async () => {
  const fixture = mock([tab(1, gpt), tab(2, gpt)]);
  await fixture.engine.reconcile(1);
  const id = fixture.groups[0].id;
  const count = fixture.mutations.length;
  await fixture.engine.reconcile(1);
  assert.equal(fixture.mutations.length, count);
  fixture.tabs.push(tab(3, gpt));
  await fixture.engine.reconcile(1);
  assert.equal(fixture.groups.length, 1);
  assert.equal(fixture.tabs[2].groupId, id);
});

test("cross-site navigation moves tabs to their destination stack", async () => {
  const fixture = mock([tab(1, gpt), tab(2, gpt), tab(3, claude), tab(4, claude)]);
  await fixture.engine.reconcile(1);
  fixture.tabs[1].url = claude;
  await fixture.engine.reconcile(1);
  assert.equal(fixture.tabs[1].groupId, fixture.tabs[2].groupId);
  assert.notEqual(fixture.tabs[0].groupId, fixture.tabs[1].groupId);
  fixture.tabs[1].url = "chrome://newtab";
  await fixture.engine.reconcile(1);
  assert.equal(fixture.tabs[1].groupId, -1);
});

test("worker suspension and browser restart recover group ownership", async () => {
  const fixture = mock([tab(1, gpt), tab(2, gpt)]);
  await fixture.engine.reconcile(1);
  delete fixture.session.ownedGroups;
  fixture.groups[0].id = 501;
  fixture.tabs.forEach(tab => { tab.groupId = 501; });
  fixture.tabs.push(tab(3, gpt));
  await createEngine(fixture.api).reconcile(1);
  assert.equal(fixture.groups.length, 1);
  assert.equal(fixture.tabs[2].groupId, 501);
  assert.equal(fixture.session.ownedGroups[501].key, "chatgpt.com");
});

test("renamed and shared groups become user-owned and are untouched", async () => {
  const fixture = mock([tab(1, gpt), tab(2, gpt), tab(3, claude), tab(4, claude)]);
  await fixture.engine.reconcile(1);
  fixture.groups[0].title = "Thesis";
  fixture.groups[1].shared = true;
  const before = structuredClone(fixture.groups);
  await fixture.engine.reconcile(1);
  assert.deepEqual(fixture.groups, before);
  assert.equal((await fixture.engine.snapshot(1)).stacks.length, 0);
});

test("pause, explicit organize, collapse and release preserve all pages", async () => {
  const fixture = mock([tab(1, gpt, { active: true }), tab(2, gpt), tab(3, claude), tab(4, claude)]);
  await fixture.engine.setSettings({ autoGroup: false });
  await fixture.engine.reconcile(1);
  assert.equal(fixture.groups.length, 0);
  await fixture.engine.reconcile(1, true);
  assert.equal(fixture.groups.length, 2);
  await fixture.engine.collapse(1, null, false);
  assert.ok(fixture.groups.every(group => !group.collapsed));
  assert.equal((await fixture.engine.collapse(1, null, true)).skipped, 1);
  assert.equal(fixture.tabs.find(tab => tab.active).id, 1);
  await fixture.engine.release(1);
  assert.equal(fixture.groups.length, 0);
  assert.equal(fixture.tabs.length, 4);
  assert.ok(fixture.tabs.every(tab => tab.groupId === -1));
  await fixture.engine.reconcile(1);
  assert.equal(fixture.groups.length, 0);
});

test("invalid, pinned and singleton tabs never create groups", () => {
  assert.equal(planGroups([tab(1, gpt), tab(2, claude, { pinned: true }), tab(3, "chrome://newtab"), tab(-1, claude)], {}).buckets.length, 0);
});

test("all-window ownership persists and release affects only the chosen window", async () => {
  const fixture = mock([tab(1, gpt), tab(2, gpt), tab(3, gpt, { windowId: 2 }), tab(4, gpt, { windowId: 2 })]);
  await fixture.engine.reconcile(1); await fixture.engine.reconcile(2);
  assert.equal(Object.keys(fixture.session.ownedGroups).length, 2);
  await fixture.engine.release(1);
  assert.equal(fixture.groups.length, 1);
  assert.equal(fixture.groups[0].windowId, 2);
  assert.equal(Object.keys(fixture.session.ownedGroups).length, 1);
});

test("paper labels count members and active highlighting works while paused without moving tabs", async () => {
  const fixture = mock([tab(1, gpt, { active: true }), tab(2, gpt), tab(3, claude), tab(4, claude)]);
  await fixture.engine.reconcile(1);
  const [chat, other] = fixture.groups;
  assert.equal(chat.title, "⧉ ChatGPT · 2");
  assert.equal(chat.color, "blue");
  assert.equal(other.color, "grey");
  await fixture.engine.setSettings({ autoGroup: false });
  await fixture.api.tabs.update(3, { active: true });
  const before = fixture.mutations.length;
  const folded = fixture.groups.map(group => group.collapsed);
  fixture.tabs.push(tab(5, gpt));
  await fixture.engine.reconcile(1);
  assert.equal(chat.color, "grey");
  assert.equal(other.color, "blue");
  assert.equal(fixture.tabs[4].groupId, -1);
  assert.deepEqual(fixture.groups.map(group => group.collapsed), folded);
  assert.ok(fixture.mutations.slice(before).every(([kind, , patch]) => kind === "update" && !("collapsed" in patch)));
  fixture.tabs.splice(1, 1);
  await fixture.engine.refreshAppearance(1);
  assert.equal(chat.title, "⧉ ChatGPT · 1");
  await fixture.engine.setSettings({ autoGroup: true });
  await fixture.engine.reconcile(1);
  assert.equal(chat.title, "⧉ ChatGPT · 2");
  assert.equal(fixture.local.knownSites["⧉ ChatGPT"], "chatgpt.com");
  assert.equal(fixture.local.knownSites["⧉ ChatGPT · 2"], undefined);
});

test("0.2.0 groups migrate in place after a cold restart, preserving folds and manual groups", async () => {
  const fixture = mock([
    tab(1, gpt, { groupId: 40 }), tab(2, gpt, { groupId: 40 }),
    tab(3, claude, { groupId: 41, active: true }), tab(4, claude, { groupId: 41 }),
    tab(5, gpt, { groupId: 42 }),
  ], [
    { id: 40, windowId: 1, title: "ChatGPT · Stacks", color: "green", collapsed: true },
    { id: 41, windowId: 1, title: "Claude · Stacks", color: "orange", collapsed: false },
    { id: 42, windowId: 1, title: "My paper", color: "purple", collapsed: false },
  ], { knownSites: { "ChatGPT · Stacks": "chatgpt.com", "Claude · Stacks": "claude.ai" } });
  await fixture.engine.reconcile(1);
  assert.deepEqual(fixture.groups.map(({ id, title, color, collapsed }) => ({ id, title, color, collapsed })), [
    { id: 40, title: "⧉ ChatGPT · 2", color: "grey", collapsed: true },
    { id: 41, title: "⧉ Claude · 2", color: "blue", collapsed: false },
    { id: 42, title: "My paper", color: "purple", collapsed: false },
  ]);
  assert.ok(fixture.mutations.every(([kind]) => kind === "update"));
  delete fixture.session.ownedGroups;
  fixture.tabs.splice(1, 1); // Chrome restored a different count than the label.
  await fixture.engine.reconcile(1);
  assert.equal(fixture.groups[0].title, "⧉ ChatGPT · 1");
  assert.equal(fixture.groups.length, 3);
});

test("interrupted count updates recover and manual count edits are respected", async () => {
  const fixture = mock([tab(1, gpt), tab(2, gpt)]);
  await fixture.engine.reconcile(1);
  const group = fixture.groups[0];
  fixture.session.ownedGroups[group.id].nextTitle = "⧉ ChatGPT · 3";
  group.title = "⧉ ChatGPT · 3";
  fixture.tabs.push(tab(3, gpt, { groupId: group.id }));
  await fixture.engine.refreshAppearance(1);
  assert.equal((await fixture.engine.snapshot(1)).stacks.length, 1);
  assert.equal(fixture.session.ownedGroups[group.id].title, "⧉ ChatGPT · 3");
  assert.equal(fixture.session.ownedGroups[group.id].nextTitle, undefined);
  group.title = "⧉ ChatGPT · 99";
  await fixture.engine.reconcile(1);
  await fixture.engine.reconcile(1);
  assert.equal(group.title, "⧉ ChatGPT · 99");
  assert.equal((await fixture.engine.snapshot(1)).stacks.length, 0);
});

test("cover recovery requires our own adjacent entry and matching website members", () => {
  const base = "chrome-extension://abcdefghijklmnop/cover.html";
  const token = "12345678-1234-1234-1234-123456789abc";
  const cover = tab(1, coverUrl(base, "chatgpt.com", token));
  const members = [tab(2, gpt, { groupId: 501 }), tab(3, gpt, { groupId: 501 })];
  const group = { id: 501, windowId: 1, title: "", shared: false };
  const recover = (tabs, groups = [group], session = {}) => resolveOwnership(tabs, groups, session, {}, base);
  assert.equal(recover([cover, ...members])[501].coverId, 1);
  assert.deepEqual(recover([{ ...cover, url: `${cover.url}&compact=1` }, ...members]), {});
  assert.deepEqual(recover([{ ...cover, url: cover.url.replace("abcdefghijklmnop", "otherextension") }, ...members]), {});
  assert.deepEqual(recover([cover, { ...members[0], url: claude }, members[1]]), {});
  assert.deepEqual(recover([cover, ...members], [{ ...group, title: "Manual" }]), {});
  assert.deepEqual(recover([cover, ...members], [{ ...group, shared: true }]), {});
  assert.deepEqual(recover([cover, ...members], [group], { 501: { title: "User renamed this", key: "chatgpt.com" } }), {});
  assert.equal(readCover({ url: cover.url.replace("site=chatgpt.com", "site=bad%2Fpath") }, base), null);
});
