import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("real favicon covers toggle native groups and preserve original pages through lifecycle changes", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-covers-test-"));
  const extension = await testExtension(profile);
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  const errors = [];
  context.on("weberror", error => errors.push(error.error().message));
  try {
    await context.route(/^https?:/, route => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><title>Original conversation</title><h1>Original page stays open</h1>',
    }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, collapseNew: true, iconCovers: false } }));
    for (const host of ["chatgpt.com", "chatgpt.com", "claude.ai", "claude.ai"]) {
      const page = await context.newPage();
      await page.goto(`https://${host}/conversation/${context.pages().length}`);
    }
    const invoke = (id, checked) => worker.evaluate(async ({ id, checked }) => {
      const active = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      await globalThis.stacksControls.menu({ menuItemId: id, checked }, active);
    }, { id, checked });
    const allTabs = () => worker.evaluate(() => chrome.tabs.query({}));
    const owners = () => worker.evaluate(async () => (await chrome.storage.session.get("ownedGroups")).ownedGroups || {});
    const groups = () => worker.evaluate(() => chrome.tabGroups.query({}));
    const covers = async () => (await allTabs()).filter(tab => tab.url.includes("/cover.html?"));
    const original = (await allTabs()).map(({ id, url }) => ({ id, url }));
    await invoke("organize");
    const originalGroupIds = (await groups()).map(group => group.id);
    await invoke("icon-covers", true);
    await expect.poll(async () => (await covers()).map(tab => tab.title).sort()).toEqual(["ChatGPT · 2", "Claude · 2"]);
    expect((await groups()).map(group => group.id)).toEqual(originalGroupIds);
    expect((await groups()).every(group => group.title === "")).toBe(true);
    for (const cover of await covers()) {
      expect(cover.groupId).toBe(-1);
      await expect.poll(async () => (await allTabs()).find(tab => tab.id === cover.id)?.favIconUrl).toContain("/_favicon/");
      const next = (await allTabs()).find(tab => tab.index === cover.index + 1);
      expect(next.groupId).not.toBe(-1);
    }
    const gptCover = (await covers()).find(tab => tab.title === "ChatGPT · 2");
    const gptId = Number(Object.entries(await owners()).find(([, owner]) => owner.key === "chatgpt.com")[0]);
    expect((await groups()).find(group => group.id === gptId).collapsed).toBe(true);
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), gptCover.id);
    await expect.poll(async () => (await groups()).find(group => group.id === gptId).collapsed).toBe(false);
    await expect.poll(async () => (await allTabs()).find(tab => tab.active)?.groupId).toBe(gptId);
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), gptCover.id);
    await expect.poll(async () => (await groups()).find(group => group.id === gptId).collapsed).toBe(true);
    await expect.poll(async () => (await allTabs()).find(tab => tab.active)?.id).not.toBe(gptCover.id);
    expect((await allTabs()).filter(tab => original.some(before => before.id === tab.id)).map(({ id, url }) => ({ id, url })).sort((a, b) => a.id - b.id))
      .toEqual([...original].sort((a, b) => a.id - b.id));

    // Cold-session recovery binds the ordinary cover to its adjacent native group.
    await worker.evaluate(() => chrome.storage.session.clear());
    await invoke("organize");
    expect(await covers()).toHaveLength(2);
    expect((await groups()).map(group => group.id)).toEqual(originalGroupIds);
    expect(Object.values(await owners()).filter(owner => owner.coverId)).toHaveLength(2);

    await invoke("auto", true);
    const added = await worker.evaluate(() => chrome.tabs.create({ url: "https://chatgpt.com/added", active: false }));
    await expect.poll(async () => (await covers()).find(tab => tab.id === gptCover.id)?.title).toBe("ChatGPT · 3");
    await worker.evaluate(id => chrome.tabs.remove(id), added.id);
    await expect.poll(async () => (await covers()).find(tab => tab.id === gptCover.id)?.title).toBe("ChatGPT · 2");

    // Closing a synthetic entry never closes or navigates any conversation.
    await worker.evaluate(id => chrome.tabs.remove(id), gptCover.id);
    await expect.poll(async () => (await groups()).find(group => group.id === gptId)?.title).toBe("⧉ ChatGPT · 2");
    expect(await covers()).toHaveLength(1);
    expect((await allTabs()).filter(tab => original.some(before => before.id === tab.id))).toHaveLength(original.length);

    // Disabling covers removes only extension-owned entries and keeps native folds.
    const before = (await groups()).map(({ id, collapsed }) => ({ id, collapsed }));
    await invoke("icon-covers", false);
    await expect.poll(async () => (await covers()).length).toBe(0);
    expect((await groups()).map(({ id, collapsed }) => ({ id, collapsed }))).toEqual(before);
    await invoke("icon-covers", true);
    await expect.poll(async () => (await covers()).length).toBe(2);

    // A manual rename relinquishes management and removes just its cover.
    await worker.evaluate(id => chrome.tabGroups.update(id, { title: "My research" }), gptId);
    await expect.poll(async () => (await covers()).length).toBe(1);
    expect((await groups()).find(group => group.id === gptId).title).toBe("My research");
    await invoke("release");
    expect(await covers()).toHaveLength(0);
    expect(await allTabs()).toHaveLength(original.length);
    expect(await groups()).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
