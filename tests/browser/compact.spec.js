import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "../../scripts/test-harness.mjs";

test("compact stacks preserve live pages with arrows, badges and editable native markers", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-compact-test-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: process.env.STACKS_HEADED !== "1",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  try {
    await browser.route(/^https?:/, route => route.request().url().endsWith("favicon.svg")
      ? route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#ee6633" d="M0 0h32v32H0z"/></svg>' })
      : route.fulfill({ contentType: "text/html", body: '<title>Original</title><link rel="icon" href="/favicon.svg"><textarea aria-label="Draft"></textarea>' }));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false } }));
    const first = await browser.newPage();
    await first.goto("https://chatgpt.com/first");
    await first.getByRole("textbox").fill("still editing");
    const second = await browser.newPage();
    await second.goto("https://chatgpt.com/second");
    const outside = await browser.newPage();
    await outside.goto("https://example.com/notes");
    const tabs = () => worker.evaluate(() => chrome.tabs.query({}));
    const originals = (await tabs()).filter(tab => tab.url.startsWith("https://chatgpt.com/")).map(tab => tab.id);
    const source = (await tabs()).find(tab => tab.url.endsWith("/notes")).windowId;
    const invoke = (id, checked) => worker.evaluate(async ({ id, checked, source }) => {
      await globalThis.stacksControls.menu({ menuItemId: id, checked }, { windowId: source });
    }, { id, checked, source });
    const covers = async () => (await tabs()).filter(tab => tab.url.includes("/cover.html?"));
    const sourceGroups = () => worker.evaluate(id => chrome.tabGroups.query({ windowId: id }), source);
    await invoke("organize");
    await expect.poll(async () => (await covers()).map(tab => tab.title)).toEqual(["ChatGPT · 2"]);
    const coverId = (await covers())[0].id;
    await invoke("compact-covers", true);
    await expect.poll(async () => (await covers()).map(tab => [tab.id, tab.title])).toEqual([[coverId, "▸ ChatGPT · 2"]]);
    expect(await sourceGroups()).toEqual([]);
    await expect.poll(async () => (await tabs()).filter(tab => originals.includes(tab.id)).every(tab => tab.windowId !== source)).toBe(true);
    await expect.poll(() => worker.evaluate(async () => {
      const anchor = (await chrome.tabs.query({})).find(tab => tab.url.endsWith("/parking.html"));
      return anchor && (await chrome.windows.get(anchor.windowId)).state;
    })).toBe("minimized");
    const parkingBefore = (await tabs()).filter(tab => tab.url.includes("/parking.html"));
    const clickCover = () => worker.evaluate(id => chrome.tabs.update(id, { active: true }), coverId);
    const coverPage = browser.pages().find(page => page.url().includes("/cover.html?"));
    await expect.poll(async () => (await covers())[0]?.favIconUrl).toMatch(/^data:image\/png;base64,/);
    const badgePixel = () => coverPage.evaluate(async () => {
      const source = new Image();
      source.src = document.querySelector("#site-icon").href;
      await source.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, 32, 32);
      return [...context.getImageData(26, 26, 1, 1).data];
    });
    await expect.poll(badgePixel).toEqual([255, 255, 255, 255]);
    await worker.evaluate(() => chrome.storage.session.clear());
    const outsideId = (await tabs()).find(tab => tab.url.endsWith("/notes")).id;
    await worker.evaluate(async ({ source, outsideId }) => {
      const [idle] = await chrome.tabs.query({ windowId: source, url: "about:blank" });
      await chrome.tabs.update(idle.id, { active: true });
      await chrome.tabs.update(outsideId, { active: true });
      const move = chrome.tabs.move.bind(chrome.tabs);
      globalThis.stacksEditLocks = 0;
      chrome.tabs.move = (...args) => {
        if (globalThis.stacksEditLocks < 2) {
          globalThis.stacksEditLocks++;
          return Promise.reject(new Error("Tabs cannot be edited right now (user may be dragging a tab)."));
        }
        return move(...args);
      };
    }, { source, outsideId });
    await clickCover();
    await expect.poll(async () => (await tabs()).filter(tab => originals.includes(tab.id)).map(tab => [tab.id, tab.windowId]))
      .toEqual(originals.map(id => [id, source]));
    await expect.poll(sourceGroups).toMatchObject([{ title: "ChatGPT", color: "green", collapsed: false }]);
    const lineId = (await sourceGroups())[0].id;
    expect((await tabs()).filter(tab => originals.includes(tab.id)).every(tab => tab.groupId === lineId)).toBe(true);
    await expect.poll(async () => (await covers())[0]?.title).toBe("▾ ChatGPT · 2");
    await expect.poll(badgePixel).toEqual([51, 125, 97, 255]);
    await coverPage.evaluate(() => chrome.runtime.sendMessage({ type: "cover-state" }));
    // Keep the empty holding window and stack marker ready for the next click.
    // Recreating either one restores/minimizes a macOS window on every collapse.
    expect((await tabs()).filter(tab => tab.url.includes("/parking.html")).map(tab => tab.id))
      .toEqual(parkingBefore.map(tab => tab.id));
    expect(await worker.evaluate(id => chrome.windows.get(id), parkingBefore[0].windowId))
      .toMatchObject({ state: "minimized" });
    await worker.evaluate(() => chrome.storage.session.clear());
    await expect(first.getByRole("textbox")).toHaveValue("still editing");
    expect(await worker.evaluate(() => globalThis.stacksEditLocks)).toBe(2);
    await expect.poll(async () => (await tabs()).some(tab => tab.active && originals.includes(tab.id))).toBe(true);
    await clickCover();
    await expect.poll(async () => (await tabs()).filter(tab => originals.includes(tab.id)).every(tab => tab.windowId !== source)).toBe(true);
    await expect.poll(async () => (await tabs()).find(tab => tab.windowId === source && tab.active)?.id).toBe(outsideId);
    expect(await sourceGroups()).toEqual([]);
    await expect.poll(async () => (await covers())[0]?.title).toBe("▸ ChatGPT · 2");
    await expect.poll(badgePixel).toEqual([255, 255, 255, 255]);
    expect((await tabs()).filter(tab => tab.url.includes("/parking.html")).map(tab => tab.id))
      .toEqual(parkingBefore.map(tab => tab.id));
    await clickCover();
    await expect.poll(async () => (await tabs()).filter(tab => originals.includes(tab.id)).every(tab => tab.windowId === source)).toBe(true);
    await expect.poll(async () => (await covers())[0]?.title).toBe("▾ ChatGPT · 2");
    // Manually closing the now-empty holding window must be safe; the next
    // collapse recreates it, without replacing or reloading the live pages.
    await worker.evaluate(id => chrome.windows.remove(id), parkingBefore[0].windowId);
    const reopened = (await sourceGroups())[0];
    await worker.evaluate(id => chrome.tabGroups.update(id, { collapsed: true }), reopened.id);
    await expect.poll(async () => (await tabs()).filter(tab => originals.includes(tab.id)).every(tab => tab.windowId !== source)).toBe(true);
    await invoke("compact-covers", false);
    await expect.poll(async () => (await sourceGroups()).length).toBe(1);
    expect((await tabs()).filter(tab => originals.includes(tab.id)).every(tab => tab.windowId === source)).toBe(true);
    expect((await tabs()).some(tab => tab.url.endsWith("/parking.html"))).toBe(false);
    await invoke("compact-covers", true);
    await expect.poll(async () => (await tabs()).filter(tab => originals.includes(tab.id)).every(tab => tab.windowId !== source)).toBe(true);
    await worker.evaluate(id => chrome.tabs.remove(id), coverId);
    await expect.poll(async () => (await tabs()).filter(tab => originals.includes(tab.id)).map(tab => [tab.id, tab.windowId]))
      .toEqual(originals.map(id => [id, source]));
    expect(await covers()).toEqual([]);
    expect(await sourceGroups()).toEqual([]);
    await expect.poll(async () => (await tabs()).filter(tab => tab.url.includes("/parking.html"))).toEqual([]);
    await expect(first.getByRole("textbox")).toHaveValue("still editing");

    // Closing the whole source window also releases its empty cached window.
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), originals[0]);
    await invoke("compact-covers", true);
    const recreatedCover = (await covers())[0].id;
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), recreatedCover);
    await expect.poll(async () => (await covers())[0]?.title).toBe("▸ ChatGPT · 2");
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), recreatedCover);
    await expect.poll(async () => (await covers())[0]?.title).toBe("▾ ChatGPT · 2");
    expect((await tabs()).filter(tab => tab.url.includes("/parking.html"))).toHaveLength(2);
    await worker.evaluate(async source => {
      await chrome.windows.create({ url: "about:blank", focused: false });
      await chrome.windows.remove(source);
    }, source);
    await expect.poll(async () => (await tabs()).filter(tab => tab.url.includes("/parking.html"))).toEqual([]);
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("custom marker text and colors survive collapse while manual and pinned tabs stay untouched", async () => {
  const profile = await mkdtemp(join(tmpdir(), "stacks-lines-test-"));
  const extension = await testExtension(profile);
  const browser = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND"],
  });
  try {
    await browser.route(/^https?:/, route => route.fulfill({ contentType: "text/html", body: "<title>Original</title>" }));
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
    await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, collapseNew: false } }));
    const first = await browser.newPage();
    await first.goto("https://chatgpt.com/one");
    const manual = await worker.evaluate(async () => {
      const pin = await chrome.tabs.create({ url: "https://chatgpt.com/pinned", pinned: true, active: false });
      const tab = await chrome.tabs.create({ url: "https://chatgpt.com/manual", active: false });
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      await chrome.tabGroups.update(groupId, { title: "我的课题", color: "yellow" });
      return { pin: pin.id, id: tab.id, groupId };
    });
    const second = await browser.newPage();
    await second.goto("https://chatgpt.com/two");
    const source = await worker.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      await globalThis.stacksControls.menu({ menuItemId: "compact-covers", checked: true }, active);
      return active.windowId;
    });
    const tabs = () => worker.evaluate(() => chrome.tabs.query({}));
    const cover = async () => (await tabs()).find(tab => tab.url.includes("/cover.html?"));
    await expect.poll(async () => (await cover())?.title).toBe("▾ ChatGPT · 2");
    const originalIds = (await tabs()).filter(tab => ["https://chatgpt.com/one", "https://chatgpt.com/two"].includes(tab.url)).map(tab => tab.id);
    const lineId = (await tabs()).find(tab => originalIds.includes(tab.id)).groupId;
    expect(lineId).not.toBe(-1);
    expect(lineId).not.toBe(manual.groupId);
    expect((await tabs()).find(tab => tab.id === manual.pin).groupId).toBe(-1);
    expect((await tabs()).find(tab => tab.id === manual.id).groupId).toBe(manual.groupId);
    await worker.evaluate(source => globalThis.stacksControls.menu({ menuItemId: "auto", checked: true }, { windowId: source }), source);
    const added = await worker.evaluate(source => chrome.tabs.create({ windowId: source, url: "https://chatgpt.com/three", active: false }), source);
    await expect.poll(async () => (await cover())?.title).toBe("▾ ChatGPT · 3");
    await expect.poll(async () => {
      const entry = await cover();
      return (await tabs()).filter(tab => tab.windowId === source && tab.index > entry.index && tab.index <= entry.index + 3).map(tab => tab.id);
    }).toEqual([...originalIds, added.id]);
    await worker.evaluate(id => chrome.tabs.update(id, { url: "https://claude.ai/single" }), added.id);
    await expect.poll(async () => (await tabs()).find(tab => tab.id === added.id)?.groupId).toBe(-1);
    await expect.poll(async () => (await cover())?.title).toBe("▾ ChatGPT · 2");
    await worker.evaluate(id => chrome.tabGroups.update(id, { title: "科研 <AI> ✨", color: "purple" }), lineId);
    const savedStyle = () => worker.evaluate(async () => (await chrome.storage.local.get("stackStyles")).stackStyles?.["chatgpt.com"]);
    await expect.poll(savedStyle).toEqual({ title: "科研 <AI> ✨", color: "purple" });
    const activeCover = await cover();
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), activeCover.id);
    await expect.poll(async () => (await cover())?.title).toBe("▸ ChatGPT · 2");
    expect(await savedStyle()).toEqual({ title: "科研 <AI> ✨", color: "purple" });
    await worker.evaluate(id => chrome.tabs.update(id, { active: true }), activeCover.id);
    await expect.poll(async () => (await cover())?.title).toBe("▾ ChatGPT · 2");
    const restoredId = (await tabs()).find(tab => originalIds.includes(tab.id)).groupId;
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), restoredId))
      .toMatchObject({ title: "科研 <AI> ✨", color: "purple", collapsed: false });
    const coverPage = browser.pages().find(page => page.url().includes("/cover.html?"));
    await expect.poll(() => coverPage.evaluate(async () => {
      const image = new Image(); image.src = document.querySelector("#site-icon").href; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d"); context.drawImage(image, 0, 0, 32, 32);
      return [...context.getImageData(26, 26, 1, 1).data];
    })).toEqual([128, 87, 175, 255]);
    expect((await tabs()).filter(tab => originalIds.includes(tab.id))).toHaveLength(2);
    expect(await worker.evaluate(id => chrome.tabGroups.get(id), manual.groupId)).toMatchObject({ title: "我的课题", color: "yellow" });
    expect((await tabs()).filter(tab => tab.url.startsWith("https:")).length).toBe(5);
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true });
  }
});
