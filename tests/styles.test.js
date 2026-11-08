import test from "node:test";
import assert from "node:assert/strict";
import { GROUP_COLORS, markerStyle } from "../extension/src/styles.js";

const site = { key: "chatgpt.com", name: "ChatGPT", color: "green" };

test("marker colors use Chrome's native palette and reject arbitrary RGB values", () => {
  assert.equal(GROUP_COLORS.length, 9);
  for (const color of GROUP_COLORS) assert.equal(markerStyle(site, { color }).color, color);
  assert.equal(markerStyle(site, { color: "#123456" }).color, "green");
});

test("custom marker titles preserve Unicode and intentional empty labels without renaming the website", () => {
  assert.deepEqual(markerStyle(site), { title: "ChatGPT", color: "green" });
  assert.deepEqual(markerStyle(site, { title: "课程 <AI> ✨", color: "purple" }), { title: "课程 <AI> ✨", color: "purple" });
  assert.equal(markerStyle(site, { title: "" }).title, "");
  assert.equal(site.name, "ChatGPT");
});
