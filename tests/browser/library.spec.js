import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("popup saves whole stacks, undoes moves, restores missing pages and survives extension reload", async () => {
  test.setTimeout(120000);
  const profile = await mkdtemp(join(tmpdir(), "stacks-library-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"] });
  const errors = []; browser.on("weberror", error => errors.push(error.error().message));
  try {
    await browser.route(/^https?:/, route => route.fulfill({ contentType: "text/html", body: `<title>${new URL(route.request().url()).pathname.slice(1)}</title><textarea aria-label="Draft"></textarea>` }));
    let worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, iconCovers: true, compactCovers: true } }));
    const papers = [];
    for (const url of ["https://arxiv.org/Paper-A", "https://nature.com/Paper-B", "https://github.com/Code"]) {
      const page = await browser.newPage(); await page.goto(url); papers.push(page);
    }
    await papers[0].getByLabel("Draft").fill("Keep this unsaved draft");
    const source = await worker.evaluate(async () => (await chrome.tabs.query({ url: "https://arxiv.org/Paper-A" }))[0].windowId);
    const popupUrl = new URL("manager.html", worker.url()).href;
    // The exact action document at its declared popup size, in an isolated profile.
    const openPopup = async () => {
      const page = await browser.newPage(); await page.goto(popupUrl); await page.setViewportSize({ width: 440, height: 580 });
      await expect(page.locator("#tabs .tab")).toHaveCount(3); return page;
    };
    let popup = await openPopup();
    const command = (type, fields = {}) => popup.evaluate(({ type, fields, source }) => chrome.runtime.sendMessage({ type, windowId: source, ...fields }), { type, fields, source });
    const originals = await worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url.startsWith("https:")).map(tab => tab.id));
    await popup.getByRole("checkbox", { name: "Select Paper-A", exact: true }).check();
    await popup.getByRole("checkbox", { name: "Select Paper-B", exact: true }).check();
    await popup.getByRole("button", { name: "New custom stack" }).click();
    await popup.getByLabel("Name", { exact: true }).fill("Literature review");
    await popup.getByRole("radio", { name: "purple", exact: true }).check();
    await popup.getByRole("button", { name: "Save stack", exact: true }).click();
    await expect(popup.getByRole("dialog")).not.toBeVisible();
    await popup.getByRole("button", { name: "Undo last move", exact: true }).click();
    await expect.poll(async () => (await command("custom-state")).tabs.filter(tab => tab.categoryId).length).toBe(0);
    await expect(papers[0].getByLabel("Draft")).toHaveValue("Keep this unsaved draft");
    const category = (await command("custom-state")).categories.find(item => item.name === "Literature review");
    await command("custom-assign", { categoryId: category.id, tabIds: originals.slice(0, 2) });
    await popup.getByRole("button", { name: "Refresh", exact: true }).click();
    await popup.getByRole("combobox", { name: "View stack" }).selectOption(category.id);
    await popup.getByRole("button", { name: "Save stack for later" }).click();
    await expect(popup.getByLabel("Saved name", { exact: true })).toHaveValue("Literature review");
    await popup.screenshot({ path: "/private/tmp/stacks-save-dialog.png" });
    await popup.getByRole("button", { name: "Save & keep open", exact: true }).click();
    await expect(popup.getByRole("tab", { name: /^Saved/ })).toHaveAttribute("aria-selected", "true");
    await expect(popup.locator(".library-item")).toHaveCount(1);
    await expect(papers[0].getByLabel("Draft")).toHaveValue("Keep this unsaved draft");
    await popup.screenshot({ path: "/private/tmp/stacks-saved-popup.png" });
    await popup.getByRole("tab", { name: "Backups", exact: true }).click();
    await popup.getByRole("button", { name: "Back up now", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("Window backed up locally.");
    await papers[1].close();
    await expect.poll(async () => (await command("custom-state")).library.backups.some(item => item.sections.flatMap(section => section.tabs).some(tab => tab.url === "https://nature.com/Paper-B"))).toBe(true);
    await popup.getByRole("tab", { name: "Backups", exact: true }).click();
    await popup.screenshot({ path: "/private/tmp/stacks-backups-popup.png" });
    const beforeRestore = await worker.evaluate(() => chrome.tabs.query({}));
    await popup.getByRole("tab", { name: /^Saved/ }).click();
    await popup.locator(".item-open").click();
    await expect(popup.locator(".item-page")).toHaveCount(2);
    await popup.getByRole("button", { name: "Reopen missing pages", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("Opened 1 page. 1 already open or unavailable.");
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({ url: "https://nature.com/Paper-B" })).length)).toBe(1);
    const afterRestore = await worker.evaluate(() => chrome.tabs.query({}));
    expect(afterRestore).toHaveLength(beforeRestore.length + 1);
    const restored = afterRestore.find(tab => (tab.pendingUrl || tab.url) === "https://nature.com/Paper-B");
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), restored.groupId)).toMatchObject({ title: "Literature review", color: "purple" });
    await expect(papers[0].getByLabel("Draft")).toHaveValue("Keep this unsaved draft");
    await popup.locator(".item-open").click();
    await popup.getByRole("button", { name: "Reopen missing pages", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("These pages are already open in this window.");
    // Save & close is explicit, durable and leaves a saved copy after restart.
    await popup.getByRole("button", { name: "Save a stack", exact: true }).click();
    await popup.locator("#save-source").selectOption(`custom:${category.id}`);
    await popup.getByLabel("Saved name", { exact: true }).fill("Archived reading");
    await popup.getByRole("checkbox", { name: "Close these pages after saving" }).check();
    await popup.getByRole("button", { name: "Save & close tabs", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("Stack saved. Pages closed.");
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => /Paper-[AB]/.test(tab.url)).length)).toBe(0);
    const extensions = await browser.newPage(); await extensions.goto("chrome://extensions");
    const developer = extensions.getByRole("switch", { name: "Developer mode" });
    if (await developer.getAttribute("aria-checked") !== "true") await developer.click();
    const nextWorker = browser.waitForEvent("serviceworker");
    await extensions.getByRole("button", { name: "Reload", exact: true }).click(); worker = await nextWorker;
    popup = await browser.newPage(); await popup.goto(popupUrl); await popup.setViewportSize({ width: 440, height: 580 });
    await popup.getByRole("tab", { name: /^Saved/ }).click();
    await expect(popup.locator(".library-item")).toHaveCount(2);
    await popup.locator(".item-open").filter({ hasText: "Archived reading" }).click();
    await popup.getByRole("button", { name: "Reopen missing pages", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("Opened 2 pages.");
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => /Paper-[AB]/.test(tab.url)).length)).toBe(2);
    const reopened = await worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => /Paper-[AB]/.test(tab.pendingUrl || tab.url)));
    expect(reopened.map(tab => tab.pendingUrl || tab.url)).toEqual(["https://arxiv.org/Paper-A", "https://nature.com/Paper-B"]);
    expect(reopened[0].groupId).toBe(reopened[1].groupId);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), reopened[0].groupId)).toMatchObject({ title: "Archived reading", color: "purple" });
    // Keyboard navigation and the unchanged 440×580 popup, including dark mode.
    await popup.getByRole("tab", { name: /^Saved/ }).focus(); await popup.keyboard.press("ArrowRight");
    await expect(popup.getByRole("tab", { name: "Backups", exact: true })).toBeFocused();
    await popup.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await popup.screenshot({ path: "/private/tmp/stacks-backups-dark.png" });
    expect(await popup.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight }))).toEqual({ width: 440, height: 580 });
    expect(errors).toEqual([]);
  } finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
});

test("collapsed website stacks save parked pages and closed source windows can be recovered", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-library-parked-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"] });
  try {
    await browser.route(/^https?:/, route => route.fulfill({ contentType: "text/html", body: "<title>Research page</title>" }));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, iconCovers: true, compactCovers: true } }));
    const source = await worker.evaluate(async () => {
      const [blank] = await chrome.tabs.query({ url: "about:blank" });
      for (const path of ["one", "two"]) await chrome.tabs.create({ windowId: blank.windowId, url: `https://chatgpt.com/c/${path}`, active: false });
      return blank.windowId;
    });
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url.startsWith("https:")).length)).toBe(2);
    await worker.evaluate(async source => { await globalThis.stacksControls.menu({ menuItemId: "auto", checked: true }, { windowId: source }); await globalThis.stacksControls.organize({ windowId: source }); }, source);
    await expect.poll(() => worker.evaluate(async source => (await chrome.tabs.query({})).filter(tab => tab.url.startsWith("https:") && tab.windowId !== source).length, source)).toBe(2);
    const popupUrl = new URL("manager.html", worker.url()).href;
    await worker.evaluate(({ source, popupUrl }) => chrome.tabs.create({ windowId: source, url: popupUrl, active: true }), { source, popupUrl });
    await expect.poll(() => browser.pages().filter(page => page.url() === popupUrl).length).toBe(1);
    let popup = browser.pages().find(page => page.url() === popupUrl); await popup.setViewportSize({ width: 440, height: 580 });
    await expect(popup.locator("#tabs .tab")).toHaveCount(2);
    await popup.getByRole("button", { name: "Save stack for later" }).click();
    await expect(popup.locator("#save-source")).toHaveValue("website:chatgpt.com");
    await popup.getByRole("checkbox", { name: "Close these pages after saving" }).check();
    await popup.getByRole("button", { name: "Save & close tabs", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("Stack saved. Pages closed.");
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url.startsWith("https:")).length)).toBe(0);
    await popup.locator(".item-open").click(); await popup.getByRole("button", { name: "Reopen missing pages", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("Opened 2 pages.");
    await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).filter(tab => tab.url.includes("cover.html?")).map(tab => tab.title))).toEqual(["▸ ChatGPT · 2"]);
    await popup.locator(".item-open").click(); await popup.getByRole("button", { name: "Reopen missing pages", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("These pages are already open in this window.");
    // Close the source while all real pages are parked elsewhere. Its logical
    // contents must still appear as a recoverable backup in a different window.
    const destination = await worker.evaluate(async () => (await chrome.windows.create({ url: "about:blank", focused: false })).id);
    await worker.evaluate(id => chrome.windows.remove(id), source);
    await worker.evaluate(({ destination, popupUrl }) => chrome.tabs.create({ windowId: destination, url: popupUrl, active: true }), { destination, popupUrl });
    await expect.poll(() => browser.pages().filter(page => page.url() === popupUrl && !page.isClosed()).length).toBe(1);
    popup = browser.pages().find(page => page.url() === popupUrl && !page.isClosed());
    await popup.getByRole("tab", { name: "Backups", exact: true }).click();
    await expect(popup.locator(".item-open").filter({ hasText: "Before window closed" })).toHaveCount(1);
    await popup.locator(".item-open").filter({ hasText: "Before window closed" }).click();
    await expect(popup.locator(".item-page")).toHaveCount(2);
    await popup.getByRole("button", { name: "Reopen missing pages", exact: true }).click();
    await expect(popup.locator("#status")).toHaveText("Opened 2 pages.");
  } finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
});
