import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

for (const mode of ["native", "parked", "expanded"]) test(`extension reload restores ${mode} favicon covers`, async () => {
  const compact = mode !== "native";
  const profile = await mkdtemp(join(tmpdir(), "stacks-reload-test-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  try {
    await browser.route(/^https?:/, route => route.fulfill({ contentType: "text/html", body: "<title>Original</title>" }));
    let worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false } }));
    for (let i = 0; i < 2; i++) {
      const page = await browser.newPage();
      await page.goto(`https://chatgpt.com/test-${i}`);
    }
    const source = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await globalThis.stacksControls.organize(tab);
      return tab.windowId;
    });
    if (compact) {
      await worker.evaluate(async source => {
        const [outside] = await chrome.tabs.query({ windowId: source, url: "about:blank" });
        await chrome.tabs.update(outside.id, { active: true });
        await globalThis.stacksControls.menu({ menuItemId: "compact-covers", checked: true }, outside);
        await globalThis.stacksControls.menu({ menuItemId: "collapse" }, outside);
      }, source);
      if (mode === "expanded") await worker.evaluate(async () => {
        const cover = (await chrome.tabs.query({})).find(tab => tab.url.includes("/cover.html?"));
        await chrome.tabs.update(cover.id, { active: true });
      });
      await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({}))
        .find(tab => tab.url.includes("/cover.html?"))?.title)).toBe(`${mode === "expanded" ? "▾" : "▸"} ChatGPT · 2`);
    }
    const before = await worker.evaluate(() => chrome.tabs.query({}));
    const originals = before.filter(tab => tab.url.startsWith("https:")).map(tab => tab.id);
    const oldCover = before.find(tab => tab.url.includes("/cover.html?"));
    if (mode === "expanded") {
      // The count can render as soon as tabs move back, before Chrome finishes
      // grouping them and focusing the real page. Wait for the completed action.
      await expect.poll(() => worker.evaluate(async ids => {
        const tabs = await Promise.all(ids.map(id => chrome.tabs.get(id)));
        return tabs.every(tab => tab.groupId >= 0) && tabs.some(tab => tab.active);
      }, originals)).toBe(true);
      await worker.evaluate(async originals => {
        const tab = await chrome.tabs.get(originals[0]);
        await chrome.tabGroups.update(tab.groupId, { title: "论文 AI", color: "purple" });
      }, originals);
      await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get("stackStyles")).stackStyles?.["chatgpt.com"]))
        .toEqual({ title: "论文 AI", color: "purple" });
    }
    const originalGroups = await worker.evaluate(() => chrome.tabGroups.query({}));
    const management = await browser.newPage();
    await management.goto("chrome://extensions");
    const toggle = management.getByRole("switch", { name: "Developer mode" });
    if (await toggle.getAttribute("aria-checked") !== "true") await toggle.click();
    const nextWorker = browser.waitForEvent("serviceworker");
    await management.getByRole("button", { name: "Reload", exact: true }).click();
    worker = await nextWorker;
    const covers = () => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url.includes("/cover.html?")));
    const title = compact ? `${mode === "expanded" ? "▾" : "▸"} ChatGPT · 2` : "ChatGPT · 2";
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual([title]);
    expect((await covers())[0].id).not.toBe(oldCover.id);
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabGroups.query({})).map(group => group.id)))
      .toEqual(originalGroups.map(group => group.id));
    if (mode === "expanded") expect(await worker.evaluate(async () => chrome.tabGroups.query({})))
      .toMatchObject([{ title: "论文 AI", color: "purple", collapsed: false }]);
    if (compact) {
      if (mode === "expanded") {
        await worker.evaluate(async () => {
          const cover = (await chrome.tabs.query({})).find(tab => tab.url.includes("/cover.html?"));
          await chrome.tabs.update(cover.id, { active: true });
        });
        await expect.poll(async () => (await covers())[0]?.title).toBe("▸ ChatGPT · 2");
      }
      expect(await worker.evaluate(async ({ source, originals }) => (await chrome.tabs.query({}))
        .filter(tab => originals.includes(tab.id)).every(tab => tab.windowId !== source), { source, originals })).toBe(true);
      const selected = await worker.evaluate(async source => (await chrome.tabs.query({ windowId: source, active: true }))[0].id, source);
      const restoredCover = (await covers())[0].id;
      await worker.evaluate(id => chrome.tabs.update(id, { active: true }), restoredCover);
      await expect.poll(() => worker.evaluate(async ({ source, originals }) => (await chrome.tabs.query({ windowId: source }))
        .filter(tab => originals.includes(tab.id)).length, { source, originals })).toBe(originals.length);
      await expect.poll(() => worker.evaluate(async ({ source, originals }) => (await chrome.tabs.query({ windowId: source, active: true }))
        .some(tab => originals.includes(tab.id)), { source, originals })).toBe(true);
      await worker.evaluate(id => chrome.tabs.update(id, { active: true }), restoredCover);
      await expect.poll(() => worker.evaluate(async source => (await chrome.tabs.query({ windowId: source, active: true }))[0].id, source)).toBe(selected);
      await worker.evaluate(id => chrome.tabs.update(id, { active: true }), restoredCover);
    }
    await expect.poll(() => worker.evaluate(async ({ source, originals }) => (await chrome.tabs.query({ windowId: source }))
      .filter(tab => originals.includes(tab.id)).map(tab => tab.id), { source, originals })).toEqual(originals);
    if (!compact) {
      const cover = (await covers())[0];
      await worker.evaluate(async id => {
        await chrome.storage.local.set({ groupRecovery: {} });
        await chrome.storage.session.clear();
        await chrome.tabs.remove(id);
      }, cover.id);
      const repair = () => worker.evaluate(async id => {
        const tab = await chrome.tabs.get(id);
        await globalThis.stacksControls.menu({ menuItemId: "repair-cover" }, tab);
      }, originals[0]);
      await repair();
      await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["ChatGPT · 2"]);
      await repair();
      expect(await covers()).toHaveLength(1);
      expect((await worker.evaluate(() => chrome.tabGroups.query({}))).map(group => group.id)).toEqual(originalGroups.map(group => group.id));
    }
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
