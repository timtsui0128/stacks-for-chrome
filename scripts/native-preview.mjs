// An isolated visible Chrome window showing the actual native tab strip.
import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testExtension } from "./test-harness.mjs";
const profile = await mkdtemp(join(tmpdir(), "stacks-native-preview-"));
const extension = await testExtension(profile);
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: false, viewport: null,
  ignoreDefaultArgs: ["--enable-automation"],
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--host-resolver-rules=MAP * ~NOTFOUND", "--window-size=1200,760"],
});
await context.route(/^https?:/, route => {
  const title = new URL(route.request().url()).searchParams.get("title") || "示例网页";
  return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><title>${title}</title><style>body{font-family:system-ui;background:#fafafa;color:#555;padding:80px}h1{font-size:28px}p{color:#888}</style><h1>${title}</h1><p>Stacks 测试窗口 · 示例网页</p>` });
});
const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
await worker.evaluate(() => chrome.storage.local.set({ settings: { autoGroup: false, collapseNew: true } }));
for (const [host, title] of [
  ["chatgpt.com", "文献综述"], ["chatgpt.com", "实验设计"], ["chatgpt.com", "代码讨论"],
  ["claude.ai", "论文润色"], ["claude.ai", "研究计划"],
  ["arxiv.org", "Attention Is All You Need"], ["arxiv.org", "A Survey of Language Models"],
]) {
  const page = await context.newPage();
  await page.goto(`https://${host}/?title=${encodeURIComponent(title)}`);
}
await worker.evaluate(async () => {
  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  await globalThis.stacksControls.organize(tab);
  await chrome.windows.update(tab.windowId, { focused: true, width: 1200, height: 760 });
});
console.log("Native tab strip ready in Google Chrome for Testing. Press Enter to close this isolated preview.");
await new Promise(resolve => process.stdin.once("data", resolve));
await context.close();
await rm(profile, { recursive: true, force: true });
