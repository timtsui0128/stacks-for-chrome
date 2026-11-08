import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("collapsing adjacent stacks never opens a different collapsed stack", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-adjacent-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  try {
    await browser.route(/^https?:/, route => route.fulfill({ contentType: "text/html", body: "<title>Original</title>" }));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: {
      autoGroup: false, collapseNew: false, iconCovers: true, compactCovers: true,
    } }));
    for (const site of ["github.com", "claude.ai", "chatgpt.com"]) for (let i = 0; i < 2; i++) {
      const page = await browser.newPage();
      await page.goto(`https://${site}/test-${i}`);
    }
    const source = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await globalThis.stacksControls.menu({ menuItemId: "compact-covers", checked: true }, tab);
      return tab.windowId;
    });
    const tabs = () => worker.evaluate(() => chrome.tabs.query({}));
    const covers = async () => (await tabs()).filter(tab => tab.url.includes("/cover.html?"));
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▾ GitHub · 2", "▾ Claude · 2", "▾ ChatGPT · 2"]);
    const original = (await tabs()).filter(tab => tab.url.startsWith("https:")).map(tab => tab.id);
    await worker.evaluate(async () => {
      const blanks = await chrome.tabs.query({ url: "about:blank" });
      await chrome.tabs.remove(blanks.map(tab => tab.id));
    });
    const click = async site => {
      const cover = (await covers()).find(tab => new URL(tab.url).searchParams.get("site") === site);
      await worker.evaluate(id => chrome.tabs.update(id, { active: true }), cover.id);
    };
    // Closing an active native group selects an adjacent control tab in Chrome.
    await worker.evaluate(async () => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === "https://github.com/test-0");
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.tabGroups.update(tab.groupId, { collapsed: true });
    });
    await expect.poll(async () => (await covers())[0]?.title).toBe("▸ GitHub · 2");
    await click("claude.ai");
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ GitHub · 2", "▸ Claude · 2", "▾ ChatGPT · 2"]);
    await worker.evaluate(async () => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === "https://chatgpt.com/test-0");
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.tabGroups.update(tab.groupId, { collapsed: true });
    });
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ GitHub · 2", "▸ Claude · 2", "▸ ChatGPT · 2"]);
    await worker.evaluate(source => globalThis.stacksControls.menu({ menuItemId: "auto", checked: true }, { windowId: source }), source);
    await expect.poll(async () => (await tabs()).filter(tab => original.includes(tab.id) && tab.windowId === source).length).toBe(0);
    await click("claude.ai");
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ GitHub · 2", "▾ Claude · 2", "▸ ChatGPT · 2"]);
    await click("claude.ai");
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ GitHub · 2", "▸ Claude · 2", "▸ ChatGPT · 2"]);
    expect((await tabs()).filter(tab => original.includes(tab.id))).toHaveLength(6);
    // Closing an ordinary active tab is a different browser-generated focus
    // change: no stack should open, even when every remaining tab is a cover.
    const disposable = await worker.evaluate(source => chrome.tabs.create({ windowId: source, index: 0, url: "https://example.com/disposable", active: true }), source);
    await expect.poll(() => worker.evaluate(async source => (await chrome.storage.session.get("lastRealTabs")).lastRealTabs?.[source], source)).toBe(disposable.id);
    await worker.evaluate(id => chrome.tabs.remove(id), disposable.id);
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ GitHub · 2", "▸ Claude · 2", "▸ ChatGPT · 2"]);
    // Wait for a complete reconciliation, not just the first pre-event read.
    await worker.evaluate(source => globalThis.stacksControls.menu({ menuItemId: "organize" }, { windowId: source }), source);
    expect((await tabs()).filter(tab => original.includes(tab.id) && tab.windowId === source)).toHaveLength(0);
    expect((await covers()).map(tab => tab.title)).toEqual(["▸ GitHub · 2", "▸ Claude · 2", "▸ ChatGPT · 2"]);
    await click("claude.ai");
    await expect.poll(async () => (await tabs()).filter(tab => original.includes(tab.id) && tab.windowId === source).length).toBe(2);
    const claudeMembers = (await tabs()).filter(tab => tab.url.startsWith("https://claude.ai/"));
    for (const member of claudeMembers) {
      await worker.evaluate(id => chrome.tabs.remove(id), member.id);
      await worker.evaluate(source => globalThis.stacksControls.menu({ menuItemId: "auto", checked: true }, { windowId: source }), source);
    }
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ GitHub · 2", "▸ ChatGPT · 2"]);
    expect((await tabs()).filter(tab => original.includes(tab.id) && tab.windowId === source)).toHaveLength(0);
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
