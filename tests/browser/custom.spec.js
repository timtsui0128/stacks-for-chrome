import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("custom stacks own mixed-site and parked tabs across navigation, grouping and reload", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-custom-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  try {
    await browser.route(/^https?:/, route => route.fulfill({ contentType: "text/html",
      body: `<title>${new URL(route.request().url()).pathname.slice(1)}</title><textarea aria-label="Draft"></textarea>` }));
    let worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, iconCovers: true, compactCovers: true } }));
    const pages = [];
    for (const url of ["https://chatgpt.com/Discussion", "https://chatgpt.com/Notes", "https://claude.ai/Review", "https://claude.ai/Outline"]) {
      const page = await browser.newPage(); await page.goto(url); pages.push(page);
    }
    await pages[0].getByRole("textbox").fill("unsaved research notes");
    const source = await worker.evaluate(async () => {
      const [blank] = await chrome.tabs.query({ url: "about:blank" });
      await chrome.tabs.update(blank.id, { active: true });
      await globalThis.stacksControls.menu({ menuItemId: "compact-covers", checked: true }, blank);
      return blank.windowId;
    });
    const tabs = () => worker.evaluate(() => chrome.tabs.query({}));
    const covers = async () => (await tabs()).filter(tab => tab.url.includes("/cover.html?"));
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ ChatGPT · 2", "▸ Claude · 2"]);
    const originals = (await tabs()).filter(tab => tab.url.startsWith("https:")).map(tab => tab.id);
    const openManager = async () => {
      const popup = await worker.evaluate(() => chrome.action.getPopup({}));
      // Playwright does not expose Chrome action bubbles as Page objects.
      // Exercise the exact popup document at its declared size; the installed
      // toolbar bubble is also checked in Chrome during release verification.
      await worker.evaluate(({ source, popup }) => chrome.tabs.create({ windowId: source, url: popup, active: true }), { source, popup });
      await expect.poll(() => browser.pages().some(page => page.url() === popup)).toBe(true);
      const page = browser.pages().find(page => page.url() === popup);
      await page.setViewportSize({ width: 440, height: 580 });
      return page;
    };
    let manager = await openManager();
    await expect(manager.getByRole("heading", { name: "All tabs", exact: true })).toBeVisible();
    await manager.screenshot({ path: "/private/tmp/stacks-ui-default.png" });
    await manager.getByRole("checkbox", { name: "Select Discussion", exact: true }).check();
    await manager.getByRole("searchbox", { name: "Search tabs" }).fill("no-such-paper-123");
    await expect(manager.getByText("No matching tabs", { exact: true })).toBeVisible();
    await expect(manager.getByText("1 selected tab is outside this view.", { exact: true })).toBeVisible();
    await manager.locator("#empty-action").click();
    await expect(manager.getByRole("checkbox", { name: "Select Discussion", exact: true })).toBeChecked();
    await manager.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(manager.getByRole("checkbox", { name: "Select Discussion", exact: true })).not.toBeChecked();
    await manager.getByRole("checkbox", { name: "Select Discussion", exact: true }).check();
    await manager.getByRole("checkbox", { name: "Select Review", exact: true }).check();
    await manager.screenshot({ path: "/private/tmp/stacks-ui-selected.png" });
    await manager.getByRole("combobox", { name: "Destination stack" }).selectOption({ label: "＋ New stack…" });
    await manager.getByLabel("Name", { exact: true }).fill("Literature review");
    await manager.getByRole("radio", { name: "purple", exact: true }).check();
    await manager.screenshot({ path: "/private/tmp/stacks-ui-editor.png" });
    await manager.getByRole("button", { name: "Save stack" }).click();
    await expect(manager.getByRole("dialog")).not.toBeVisible();
    await expect(manager.getByRole("status").filter({ hasText: "Custom stack created." })).toBeVisible();
    const managed = (await tabs()).filter(tab => ["https://chatgpt.com/Discussion", "https://claude.ai/Review"].includes(tab.url));
    expect(managed).toHaveLength(2);
    expect(managed.every(tab => tab.windowId === source && tab.groupId === managed[0].groupId)).toBe(true);
    const customId = managed[0].groupId;
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), customId)).toMatchObject({ title: "Literature review", color: "purple" });
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["▸ ChatGPT · 1", "▸ Claude · 1"]);
    await expect(pages[0].getByRole("textbox")).toHaveValue("unsaved research notes");
    // Automatic reconciliation, site changes and another same-site tab cannot
    // pull a manually classified page back into a website stack.
    await worker.evaluate(async ({ source, id }) => {
      await globalThis.stacksControls.menu({ menuItemId: "auto", checked: true }, { windowId: source });
      await chrome.tabs.update(id, { url: "https://github.com/Changed" });
      await chrome.tabs.create({ windowId: source, active: false, url: "https://chatgpt.com/New" });
      await globalThis.stacksControls.organize({ windowId: source });
    }, { source, id: managed[1].id });
    expect((await tabs()).filter(tab => managed.some(item => item.id === tab.id)).every(tab => tab.groupId === customId)).toBe(true);
    await expect.poll(async () => (await covers()).find(tab => tab.title.includes("ChatGPT"))?.title).toBe("▸ ChatGPT · 2");
    await manager.getByRole("button", { name: "Refresh", exact: true }).click();
    await manager.getByRole("combobox", { name: "View stack" }).selectOption({ label: "Literature review · 2" });
    await manager.getByRole("button", { name: "Edit stack", exact: true }).click();
    await manager.getByLabel("Name", { exact: true }).fill("Paper <AI> ✨");
    await manager.getByRole("radio", { name: "orange", exact: true }).check();
    await manager.getByRole("button", { name: "Save stack" }).click();
    await expect(manager.getByRole("heading", { name: "Paper <AI> ✨", exact: true })).toBeVisible();
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), customId)).toMatchObject({ title: "Paper <AI> ✨", color: "orange" });
    // Keep the tab group collapsed through unrelated automatic updates.
    await worker.evaluate(id => chrome.tabGroups.update(id, { collapsed: true }), customId);
    await worker.evaluate(source => globalThis.stacksControls.organize({ windowId: source }), source);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), customId)).toMatchObject({ collapsed: true });
    // Real extension reload discards the worker and manager, while preserving
    // custom groups and the same live user tabs.
    const extensions = await browser.newPage(); await extensions.goto("chrome://extensions");
    const developer = extensions.getByRole("switch", { name: "Developer mode" });
    if (await developer.getAttribute("aria-checked") !== "true") await developer.click();
    const nextWorker = browser.waitForEvent("serviceworker");
    await extensions.getByRole("button", { name: "Reload", exact: true }).click();
    worker = await nextWorker;
    manager = await openManager();
    await expect(manager.getByRole("option", { name: "Paper <AI> ✨ · 2", exact: true })).toHaveCount(1);
    expect((await tabs()).filter(tab => managed.some(item => item.id === tab.id)).every(tab => tab.groupId === customId)).toBe(true);
    // Explicit opt-out is the only manager action that re-enables auto grouping.
    await manager.getByRole("checkbox", { name: "Select Discussion", exact: true }).check();
    await manager.getByRole("button", { name: "Return to automatic", exact: true }).click();
    await expect.poll(async () => (await covers()).find(tab => tab.title.includes("ChatGPT"))?.title).toBe("▸ ChatGPT · 3");
    expect((await tabs()).find(tab => tab.id === managed[0].id)?.groupId).not.toBe(customId);
    expect((await tabs()).find(tab => tab.id === managed[1].id)?.groupId).toBe(customId);
    expect((await tabs()).filter(tab => originals.includes(tab.id))).toHaveLength(4);
    await expect(pages[0].getByRole("textbox")).toHaveValue("unsaved research notes");
    // Empty categories can be reused, tabs can move between categories, and an
    // existing target group is reused instead of creating duplicate groups.
    await manager.getByRole("checkbox", { name: "Select Changed", exact: true }).check();
    await manager.getByRole("button", { name: "New custom stack" }).click();
    await manager.getByLabel("Name", { exact: true }).fill("Reading list");
    await manager.getByRole("checkbox", { name: "Include 1 selected tab", exact: true }).uncheck();
    await manager.getByRole("button", { name: "Save stack" }).click();
    await expect(manager.getByRole("dialog")).not.toBeVisible();
    await expect(manager.getByRole("checkbox", { name: "Select Changed", exact: true })).toBeChecked();
    await manager.getByRole("checkbox", { name: "Select Notes", exact: true }).check();
    await manager.getByRole("combobox", { name: "Destination stack" }).selectOption({ label: "Reading list" });
    await manager.getByRole("button", { name: "Move tabs", exact: true }).click();
    await expect(manager.getByRole("option", { name: "Reading list · 2", exact: true })).toHaveCount(1);
    const readingGroup = (await tabs()).find(tab => tab.id === managed[1].id).groupId;
    await manager.getByRole("checkbox", { name: "Select Outline", exact: true }).check();
    await manager.getByRole("button", { name: "Move tabs", exact: true }).click();
    await expect(manager.getByRole("option", { name: "Reading list · 3", exact: true })).toHaveCount(1);
    expect((await tabs()).filter(tab => tab.groupId === readingGroup)).toHaveLength(3);
    await expect.poll(async () => (await covers()).some(tab => tab.title.includes("Claude"))).toBe(false);
    await manager.getByRole("combobox", { name: "View stack" }).selectOption({ label: "Paper <AI> ✨ · 0" });
    await manager.getByRole("button", { name: "Edit stack", exact: true }).click();
    await manager.getByRole("button", { name: "Delete empty stack", exact: true }).click();
    await expect(manager.getByRole("dialog")).not.toBeVisible();
    await expect(manager.getByRole("option", { name: "Paper <AI> ✨ · 0", exact: true })).toHaveCount(0);
    expect((await tabs()).filter(tab => originals.includes(tab.id))).toHaveLength(4);
    await manager.screenshot({ path: "/private/tmp/stacks-custom-manager.png", fullPage: true });
    await manager.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await manager.screenshot({ path: "/private/tmp/stacks-ui-dark.png" });
  } finally {
    await browser.close(); await rm(profile, { recursive: true, force: true });
  }
});
