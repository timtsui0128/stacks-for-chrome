import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("automatic website logos survive login redirects, reload and explicit repair without changing custom groups", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-auth-logo-test-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  try {
    await browser.route(/^https?:/, route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("favicon.svg")) return route.fulfill({ contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="${url.hostname === "login.microsoftonline.com" ? "#2255ee" : "#dd4422"}" d="M0 0h32v32H0z"/></svg>` });
      return route.fulfill({ contentType: "text/html", body: '<title>Website page</title><link rel="icon" href="/favicon.svg"><p>Original page</p>' });
    });
    let worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, collapseNew: false } }));
    for (const path of ["one", "two"]) {
      const page = await browser.newPage();
      await page.goto(`https://canvas.manchester.ac.uk/${path}`);
    }
    const fixture = await worker.evaluate(async () => {
      const originals = (await chrome.tabs.query({})).filter(tab => tab.url.startsWith("https://canvas.manchester.ac.uk/"));
      const source = originals[0].windowId;
      const manual = await chrome.tabs.create({ windowId: source, url: "https://example.com/custom", active: false });
      const customGroup = await chrome.tabs.group({ tabIds: [manual.id] });
      await chrome.tabGroups.update(customGroup, { title: "自定义", color: "orange" });
      await globalThis.stacksControls.menu({ menuItemId: "compact-covers", checked: true }, originals[0]);
      return { originals: originals.map(tab => tab.id), source, customGroup, manualId: manual.id };
    });
    const tabs = () => worker.evaluate(() => chrome.tabs.query({}));
    const covers = async () => (await tabs()).filter(tab => tab.url.includes("/cover.html?"));
    const cover = async () => (await covers()).find(tab => tab.url.includes("site=canvas.manchester.ac.uk"));
    await expect.poll(async () => (await cover())?.title).toBe("▾ Canvas · 2");
    const lineId = (await tabs()).find(tab => fixture.originals.includes(tab.id)).groupId;
    await worker.evaluate(id => chrome.tabGroups.update(id, { title: "课程", color: "purple" }), lineId);
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get("stackStyles")).stackStyles?.["canvas.manchester.ac.uk"]))
      .toEqual({ title: "课程", color: "purple" });
    const baseIcon = async () => browser.pages().find(page => page.url().includes("site=canvas.manchester.ac.uk"))
      .locator("#site-mark").getAttribute("src");
    await expect.poll(baseIcon).toMatch(/^data:image\/png;base64,/);
    const originalLogo = await baseIcon();
    const unrelated = await worker.evaluate(async source => {
      const tab = await chrome.tabs.create({ windowId: source, url: "https://login.microsoftonline.com/tenant/saml2?unrelated=1", active: false });
      await globalThis.stacksControls.menu({ menuItemId: "auto", checked: true }, { windowId: source });
      return tab.id;
    }, fixture.source);
    for (const [index, id] of fixture.originals.entries()) {
      await worker.evaluate(({ id, index }) => chrome.tabs.update(id, { url: `https://login.microsoftonline.com/tenant/saml2?flow=${index}` }), { id, index });
    }
    await expect.poll(async () => (await cover())?.title).toBe("▾ Canvas · 2");
    await expect.poll(async () => (await tabs()).filter(tab => fixture.originals.includes(tab.id)).every(tab => tab.groupId === lineId)).toBe(true);
    expect(await baseIcon()).toBe(originalLogo);
    expect((await tabs()).find(tab => tab.id === unrelated).groupId).toBe(-1);
    expect(await covers()).toHaveLength(1);
    const clickCover = async () => worker.evaluate(id => chrome.tabs.update(id, { active: true }), (await cover()).id);
    await clickCover();
    await expect.poll(async () => (await cover())?.title).toBe("▸ Canvas · 2");
    await clickCover();
    await expect.poll(async () => (await cover())?.title).toBe("▾ Canvas · 2");
    expect(await baseIcon()).toBe(originalLogo);

    const loginPopup = await worker.evaluate(async ({ source, originals }) => chrome.tabs.create({ windowId: source,
      openerTabId: originals[0], url: "https://login.canvas.manchester.ac.uk/login", active: false }), fixture);
    fixture.originals.push(loginPopup.id);
    await expect.poll(async () => (await cover())?.title).toBe("▾ Canvas · 3");
    await expect.poll(async () => (await tabs()).find(tab => tab.id === loginPopup.id)?.groupId).not.toBe(-1);
    expect(await baseIcon()).toBe(originalLogo);
    expect((await tabs()).find(tab => tab.id === unrelated).groupId).toBe(-1);
    expect(await covers()).toHaveLength(1);

    const management = await browser.newPage();
    await management.goto("chrome://extensions");
    const developer = management.getByRole("switch", { name: "Developer mode" });
    if (await developer.getAttribute("aria-checked") !== "true") await developer.click();
    const nextWorker = browser.waitForEvent("serviceworker");
    await management.getByRole("button", { name: "Reload", exact: true }).click();
    worker = await nextWorker;
    await expect.poll(async () => (await cover())?.title).toBe("▾ Canvas · 3");
    expect(await baseIcon()).toBe(originalLogo);

    // Recreate the already broken 0.7.0 state: missing entry, one login page
    // detached, one in the saved category. Explicit repair restores only these.
    await worker.evaluate(async ({ originals }) => {
      const { settings } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({ settings: { ...settings, autoGroup: false }, compactRecovery: {} });
      await chrome.storage.session.set({ compactStacks: {} });
      const cover = (await chrome.tabs.query({})).find(tab => tab.url.includes("site=canvas.manchester.ac.uk"));
      await chrome.tabs.ungroup([originals[0]]);
      await chrome.tabs.remove(cover.id);
      const selected = await chrome.tabs.get(originals[0]);
      await globalThis.stacksControls.menu({ menuItemId: "repair-cover" }, selected);
    }, fixture);
    await expect.poll(async () => (await cover())?.title).toBe("▾ Canvas · 3");
    expect(await baseIcon()).toBe(originalLogo);
    const repairedGroup = (await tabs()).find(tab => fixture.originals.includes(tab.id)).groupId;
    expect((await tabs()).filter(tab => fixture.originals.includes(tab.id)).every(tab => tab.groupId === repairedGroup)).toBe(true);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), repairedGroup)).toMatchObject({ title: "课程", color: "purple" });
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), fixture.customGroup)).toMatchObject({ title: "自定义", color: "orange" });
    expect((await tabs()).find(tab => tab.id === fixture.manualId).groupId).toBe(fixture.customGroup);
    expect((await tabs()).find(tab => tab.id === unrelated).groupId).toBe(-1);
    expect(await covers()).toHaveLength(1);
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
