import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("duplicate automatic website stacks merge; remapped group IDs retain logos; manual names stay separate", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-duplicate-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"] });
  try {
    await browser.route(/^https?:/, route => route.fulfill({ contentType: "text/html", body: "<title>Conversation</title><textarea aria-label='Draft'></textarea>" }));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, collapseNew: false, iconCovers: true, compactCovers: true } }));
    const pages = [];
    for (let i = 0; i < 4; i++) { const page = await browser.newPage(); await page.goto(`https://chatgpt.com/c/${i}`); pages.push(page); }
    await pages[0].getByLabel("Draft").fill("Never reload this draft");
    const source = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true }); await globalThis.stacksControls.organize(tab); return tab.windowId;
    });
    const covers = () => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url.includes("/cover.html?")));
    await expect.poll(async () => (await covers()).length).toBe(1);
    const originals = await worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url.startsWith("https:")).map(tab => tab.id));
    await worker.evaluate(async ({ source, originals }) => {
      const { compactStacks } = await chrome.storage.session.get("compactStacks");
      const [oldToken, old] = Object.entries(compactStacks)[0];
      const ids = originals.slice(2);
      const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: source } });
      await chrome.tabGroups.update(groupId, { title: "ChatGPT", color: "green", collapsed: false });
      const token = crypto.randomUUID();
      const first = await chrome.tabs.get(ids[0]);
      const cover = await chrome.tabs.create({ windowId: source, index: first.index, active: false,
        url: `${chrome.runtime.getURL("cover.html")}?site=chatgpt.com&stack=${token}&compact=1` });
      if (cover.groupId !== -1) await chrome.tabs.ungroup([cover.id]);
      compactStacks[oldToken] = { ...old, memberIds: originals.slice(0, 2) };
      compactStacks[token] = { key: "chatgpt.com", windowId: source, coverId: cover.id, coverIndex: cover.index,
        lineGroupId: groupId, lineTitle: "ChatGPT", lineColor: "green", memberIds: ids, collapsed: false };
      await chrome.storage.session.set({ compactStacks }); await chrome.storage.local.set({ compactRecovery: compactStacks });
      await globalThis.stacksControls.organize({ windowId: source });
    }, { source, originals });
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▾ ChatGPT · 4"]);
    const groups = await worker.evaluate(() => chrome.tabGroups.query({})); expect(groups).toHaveLength(1);
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id)).map(tab => tab.id).sort(), originals)).toEqual([...originals].sort());
    await expect(pages[0].getByLabel("Draft")).toHaveValue("Never reload this draft");
    // Reproduce Chrome's restart ID remapping while retaining the durable cover token.
    await worker.evaluate(async ({ source, originals }) => {
      const { compactStacks } = await chrome.storage.session.get("compactStacks");
      const [token, record] = Object.entries(compactStacks)[0];
      await chrome.tabs.ungroup(originals);
      const groupId = await chrome.tabs.group({ tabIds: originals, createProperties: { windowId: source } });
      await chrome.tabGroups.update(groupId, { title: record.lineTitle, color: record.lineColor, collapsed: false });
      compactStacks[token].memberIds = [-100, -101];
      await chrome.storage.session.set({ compactStacks }); await chrome.storage.local.set({ compactRecovery: compactStacks });
      await globalThis.stacksControls.organize({ windowId: source });
    }, { source, originals });
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▾ ChatGPT · 4"]);
    const manual = await worker.evaluate(async source => {
      const a = await chrome.tabs.create({ windowId: source, url: "https://chatgpt.com/manual/1", active: false });
      const b = await chrome.tabs.create({ windowId: source, url: "https://chatgpt.com/manual/2", active: false });
      const id = await chrome.tabs.group({ tabIds: [a.id, b.id], createProperties: { windowId: source } });
      await chrome.tabGroups.update(id, { title: "ChatGPT", color: "green" });
      await globalThis.stacksControls.organize({ windowId: source });
      return { id, tabs: [a.id, b.id] };
    }, source);
    expect(await worker.evaluate(async ids => (await chrome.tabs.query({})).filter(tab => ids.includes(tab.id)).map(tab => tab.groupId), manual.tabs)).toEqual([manual.id, manual.id]);
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▾ ChatGPT · 4"]);
  } finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
});
