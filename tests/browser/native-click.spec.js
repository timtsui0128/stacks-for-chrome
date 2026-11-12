import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("native logo clicks survive Chrome's mouse-down edit lock without stealing later focus", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-native-click-"));
  const extension = await testExtension(profile);
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  try {
    await context.route(/^https?:/, route => route.fulfill({
      contentType: "text/html", body: '<title>Reading notes</title><textarea>Keep this draft</textarea>',
    }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: {
      autoGroup: false, collapseNew: true, iconCovers: true, compactCovers: false,
    } }));
    const pages = [];
    for (const url of ["https://chatgpt.com/one", "https://chatgpt.com/two", "https://example.org/notes"]) {
      const page = await context.newPage();
      await page.goto(url);
      pages.push(page);
    }
    const tabs = () => worker.evaluate(() => chrome.tabs.query({}));
    const original = (await tabs()).map(({ id, url }) => ({ id, url }));
    const outside = (await tabs()).find(tab => tab.url === "https://example.org/notes");
    await worker.evaluate(async tab => globalThis.stacksControls.organize(tab), outside);
    await expect.poll(async () => (await tabs()).filter(tab => tab.url.includes("/cover.html?")).length).toBe(1);
    const cover = (await tabs()).find(tab => tab.url.includes("/cover.html?"));
    const member = (await tabs()).find(tab => tab.url === "https://chatgpt.com/one");
    const group = () => worker.evaluate(id => chrome.tabGroups.get(id), member.groupId);
    const active = () => worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
    const focusedOutside = async () => {
      const tab = await active();
      return tab.groupId === -1 && tab.id !== cover.id;
    };

    // Chrome rejects group edits and focus changes while a tab click is held.
    // API-driven activation alone never exercises this real mouse interaction.
    await worker.evaluate(() => {
      const updateGroup = chrome.tabGroups.update.bind(chrome.tabGroups);
      const updateTab = chrome.tabs.update.bind(chrome.tabs);
      globalThis.nativeClickLock = { group: 0, focus: 0, rejected: 0 };
      chrome.tabGroups.update = (...args) => {
        if (Date.now() < nativeClickLock.group && "collapsed" in args[1]) {
          nativeClickLock.rejected++;
          return Promise.reject(new Error("Tabs cannot be edited right now (user may be dragging a tab)."));
        }
        return updateGroup(...args);
      };
      chrome.tabs.update = (...args) => {
        if (Date.now() < nativeClickLock.focus && args[1]?.active) {
          nativeClickLock.rejected++;
          return Promise.reject(new Error("Tabs cannot be edited right now (user may be dragging a tab)."));
        }
        return updateTab(...args);
      };
      globalThis.clickNativeCover = async (id, kind) => {
        nativeClickLock[kind] = Date.now() + 600;
        return updateTab(id, { active: true });
      };
    });
    const click = kind => worker.evaluate(({ id, kind }) => clickNativeCover(id, kind), { id: cover.id, kind });

    await click("group");
    await expect.poll(group).toMatchObject({ collapsed: false });
    await expect.poll(active).toMatchObject({ groupId: member.groupId });
    await click("group");
    await expect.poll(group).toMatchObject({ collapsed: true });
    await expect.poll(focusedOutside).toBe(true);
    await click("focus");
    await expect.poll(active).toMatchObject({ groupId: member.groupId });
    await click("focus");
    await expect.poll(group).toMatchObject({ collapsed: true });
    await expect.poll(focusedOutside).toBe(true);
    expect(await worker.evaluate(() => nativeClickLock.rejected)).toBeGreaterThan(4);

    // A user who selects another page during the wait cancels that click.
    const rejected = await worker.evaluate(() => nativeClickLock.rejected);
    await click("group");
    await expect.poll(() => worker.evaluate(() => nativeClickLock.rejected)).toBeGreaterThan(rejected);
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), outside.id);
    await expect.poll(() => worker.evaluate(() => Date.now() >= nativeClickLock.group)).toBe(true);
    const coverPage = context.pages().find(page => page.url().includes("/cover.html?"));
    await coverPage.evaluate(() => chrome.runtime.sendMessage({ type: "cover-state" }));
    await expect.poll(active).toMatchObject({ id: outside.id });
    expect(await group()).toMatchObject({ collapsed: true });
    expect((await tabs()).filter(tab => original.some(before => before.id === tab.id)).map(({ id, url }) => ({ id, url })))
      .toEqual(original);
    for (const page of pages) await expect(page.locator("textarea")).toHaveValue("Keep this draft");
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
