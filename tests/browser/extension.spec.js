import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("toolbar-only grouping, native expansion, automatic updates and preservation", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-test-"));
  const extension = await testExtension(profile);
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  const errors = [];
  context.on("weberror", error => errors.push(`${error.page()?.url()}: ${error.error().message}`));
  try {
    await context.route(/^https?:/, route => {
      const title = new URL(route.request().url()).searchParams.get("title") || "测试网页";
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><title>${title}</title><h1>${title}</h1>` });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, collapseNew: true, iconCovers: false } }));
    const fixture = [
      ["chatgpt.com", "对话一"], ["chatgpt.com", "对话二"], ["chatgpt.com", "对话三"],
      ["claude.ai", "研究计划"], ["claude.ai", "论文润色"],
      ["arxiv.org", "论文一"], ["arxiv.org", "论文二"],
    ];
    for (const [host, title] of fixture) {
      const page = await context.newPage();
      await page.goto(`https://${host}/test?title=${encodeURIComponent(title)}`);
    }
    const tabs = await worker.evaluate(async () => {
      const pin = await chrome.tabs.create({ url: "https://chatgpt.com/pinned", pinned: true, active: false });
      const manual = await chrome.tabs.create({ url: "https://chatgpt.com/manual", active: false });
      const manualGroup = await chrome.tabs.group({ tabIds: [manual.id] });
      await chrome.tabGroups.update(manualGroup, { title: "我的课题", color: "yellow" });
      const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      return { pin, manualGroup, active };
    });
    const groups = () => worker.evaluate(() => chrome.tabGroups.query({}));
    const managed = async () => (await groups()).filter(group => group.title.startsWith("⧉ "));
    const invoke = (method, info) => worker.evaluate(async ({ method, info }) => {
      const controls = globalThis.stacksControls;
      const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (method === "organize") await controls.organize(tab);
      else await controls.menu(info, tab);
    }, { method, info });
    const tabCount = async () => (await worker.evaluate(() => chrome.tabs.query({}))).length;
    const count = await tabCount();
    // Simulate the user's installed 0.2.0 groups before running the new code.
    const legacyId = await worker.evaluate(async () => {
      const tabs = (await chrome.tabs.query({})).filter(tab => tab.url.startsWith("https://chatgpt.com/test"));
      const id = await chrome.tabs.group({ tabIds: tabs.map(tab => tab.id) });
      await chrome.tabGroups.update(id, { title: "ChatGPT · Stacks", color: "green", collapsed: true });
      await chrome.storage.local.set({ knownSites: { "ChatGPT · Stacks": "chatgpt.com" } });
      return id;
    });
    await invoke("organize");
    expect(await managed()).toHaveLength(3);
    expect(await tabCount()).toBe(count);
    expect(await worker.evaluate(() => chrome.runtime.getManifest().action.default_popup)).toBe("manager.html");
    expect(await worker.evaluate(() => chrome.action.getPopup({}))).toMatch(/\/manager.html$/);
    expect((await groups()).find(group => group.id === tabs.manualGroup).title).toBe("我的课题");
    expect(await worker.evaluate(id => chrome.tabs.get(id), tabs.pin.id)).toMatchObject({ groupId: -1, pinned: true });
    const activeAfter = await worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
    expect(activeAfter[0].id).toBe(tabs.active.id);
    for (const group of await managed()) expect(group.collapsed).toBe(group.id !== activeAfter[0].groupId);

    const gpt = (await managed()).find(group => group.title === "⧉ ChatGPT · 3");
    expect(gpt.id).toBe(legacyId);
    expect(gpt.color).toBe("grey");
    expect((await groups()).find(group => group.id === activeAfter[0].groupId).color).toBe("blue");
    await worker.evaluate(id => chrome.tabGroups.update(id, { collapsed: false }), gpt.id);
    expect((await groups()).find(group => group.id === gpt.id).collapsed).toBe(false);
    await worker.evaluate(id => chrome.tabGroups.update(id, { collapsed: true }), gpt.id);
    expect((await groups()).find(group => group.id === gpt.id).collapsed).toBe(true);

    // Activation events still update the paper accent while auto-grouping is paused.
    await worker.evaluate(async id => {
      const member = (await chrome.tabs.query({ groupId: id }))[0];
      await chrome.tabs.update(member.id, { active: true });
    }, gpt.id);
    await expect.poll(async () => (await groups()).find(group => group.id === gpt.id).color).toBe("blue");
    expect((await groups()).find(group => group.id === activeAfter[0].groupId).color).toBe("grey");
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), activeAfter[0].id);
    await expect.poll(async () => (await groups()).find(group => group.id === gpt.id).color).toBe("grey");
    await invoke("menu", { menuItemId: "expand" });
    expect((await managed()).every(group => !group.collapsed)).toBe(true);
    await invoke("menu", { menuItemId: "collapse" });
    expect((await groups()).find(group => group.id === gpt.id).collapsed).toBe(true);

    await invoke("menu", { menuItemId: "auto", checked: true });
    const created = await worker.evaluate(() => chrome.tabs.create({ url: "https://claude.ai/new", active: false }));
    await expect.poll(async () => (await worker.evaluate(id => chrome.tabs.get(id), created.id)).groupId).not.toBe(-1);
    await worker.evaluate(id => chrome.tabs.update(id, { url: "https://arxiv.org/new" }), created.id);
    await expect.poll(async () => {
      const tab = await worker.evaluate(id => chrome.tabs.get(id), created.id);
      return (await groups()).find(group => group.id === tab.groupId)?.title;
    }).toBe("⧉ arXiv · 3");
    expect((await managed()).find(group => group.title.startsWith("⧉ Claude")).title).toBe("⧉ Claude · 2");
    await worker.evaluate(() => chrome.storage.session.clear());
    await invoke("organize");
    expect(await managed()).toHaveLength(3);
    await invoke("menu", { menuItemId: "collapse-new", checked: false });
    expect((await worker.evaluate(() => chrome.storage.local.get("settings"))).settings.collapseNew).toBe(false);
    const beforeRelease = await tabCount();
    await invoke("menu", { menuItemId: "release" });
    expect(await managed()).toHaveLength(0);
    expect(await tabCount()).toBe(beforeRelease);
    expect(await groups()).toHaveLength(1);
    expect((await groups())[0].title).toBe("我的课题");
    expect((await worker.evaluate(() => chrome.storage.local.get("settings"))).settings.autoGroup).toBe(false);
    expect(await worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("Ⅱ");
    expect((await worker.evaluate(() => chrome.tabs.query({}))).some(tab => tab.url.startsWith("chrome-extension:"))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
