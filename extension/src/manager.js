import { GROUP_COLORS } from "./styles.js";
import { stackAccent } from "./covers.js";

const $ = id => document.getElementById(id);
const sourceWindow = await chrome.windows.getCurrent({ windowTypes: ["normal"] });
let data = { tabs: [], categories: [] };
let filter = "all";
let editing = null;
let busy = false;
const selected = new Set((await chrome.tabs.query({ windowId: sourceWindow.id, highlighted: true })).map(tab => tab.id));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function colorFor(color) { return stackAccent({ color }).fill; }
function visibleTabs() {
  const query = $("search").value.trim().toLowerCase();
  return data.tabs.filter(tab => (filter === "all" || (filter === "automatic" ? !tab.categoryId : tab.categoryId === filter))
    && (!query || `${tab.title} ${tab.url}`.toLowerCase().includes(query)));
}
function renderSelection() {
  const visible = visibleTabs();
  $("selection-count").textContent = `${selected.size} selected`;
  $("move").disabled = busy || !selected.size || !$("destination").value;
  $("release").disabled = busy || !selected.size || [...selected].some(id => !data.tabs.find(tab => tab.id === id)?.categoryId);
  $("select-all").checked = !!visible.length && visible.every(tab => selected.has(tab.id));
  $("select-all").indeterminate = visible.some(tab => selected.has(tab.id)) && !$("select-all").checked;
}
function render() {
  for (const id of selected) if (!data.tabs.some(tab => tab.id === id)) selected.delete(id);
  const category = data.categories.find(item => item.id === filter);
  if (!category && !["all", "automatic"].includes(filter)) filter = "all";
  $("heading").textContent = category?.name || (filter === "automatic" ? "Automatic tabs" : "All tabs");
  $("description").textContent = category ? "Custom tabs stay out of automatic grouping." : "Select tabs to keep together in your tab bar.";
  $("edit-stack").hidden = !category;
  const nav = $("categories"); nav.replaceChildren();
  for (const item of [{ id: "all", name: "All tabs", color: "grey" }, { id: "automatic", name: "Automatic", color: "grey" }, ...data.categories]) {
    const button = element("button", "category");
    button.setAttribute("aria-current", String(filter === item.id));
    const dot = element("span", "dot"); dot.style.background = colorFor(item.color);
    const count = data.tabs.filter(tab => item.id === "all" || (item.id === "automatic" ? !tab.categoryId : tab.categoryId === item.id)).length;
    button.append(dot, element("span", "label", item.name), element("span", "count", count));
    button.addEventListener("click", () => { filter = item.id; render(); });
    nav.append(button);
  }
  const destination = $("destination").value;
  $("destination").replaceChildren(new Option("Choose a stack…", ""), ...data.categories.map(item => new Option(item.name, item.id)));
  $("destination").value = data.categories.some(item => item.id === destination) ? destination : "";
  const visible = visibleTabs();
  $("tabs").replaceChildren();
  for (const tab of visible) {
    const row = element("label", "tab");
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = selected.has(tab.id);
    check.setAttribute("aria-label", `Select ${tab.title}`);
    check.addEventListener("change", () => { if (check.checked) selected.add(tab.id); else selected.delete(tab.id); renderSelection(); });
    const text = element("span", "tab-text");
    let host; try { host = new URL(tab.url).hostname || "Local file"; } catch { host = tab.website; }
    text.append(element("span", "tab-title", tab.title), element("span", "tab-meta", `${host}${tab.parked ? " · Collapsed stack" : ""}`));
    const stack = data.categories.find(item => item.id === tab.categoryId);
    row.append(check, text, element("span", "badge", stack?.name || "Automatic"));
    $("tabs").append(row);
  }
  $("tab-count").textContent = `${visible.length} ${visible.length === 1 ? "tab" : "tabs"}`;
  $("empty").hidden = !!visible.length;
  renderSelection();
}
async function request(type, fields = {}, message = "", dialog = false) {
  if (busy) return false;
  busy = true; renderSelection();
  const status = dialog ? $("dialog-status") : $("status"); status.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({ type, windowId: sourceWindow.id, ...fields });
    if (!response?.ok) throw new Error(response?.error || "Stacks is updating. Please reload this page.");
    data = response;
    if (type !== "custom-state" && type !== "custom-rename") selected.clear();
    render();
    $("status").classList.remove("error"); $("status").textContent = message;
    return true;
  } catch (error) {
    status.textContent = error.message; status.classList.add("error"); return false;
  } finally { busy = false; renderSelection(); }
}
function openEditor(category = null) {
  editing = category?.id || null;
  $("dialog-title").textContent = category ? "Edit custom stack" : "New custom stack";
  $("stack-name").value = category?.name || "";
  $("dialog-status").textContent = "";
  $("delete-stack").hidden = !category;
  $("include-label").hidden = !!category || !selected.size;
  $("include-selected").checked = true;
  $("colors").replaceChildren();
  for (const color of GROUP_COLORS) {
    const label = element("label", "swatch"); label.title = color;
    const input = document.createElement("input"); input.type = "radio"; input.name = "color"; input.value = color;
    input.checked = color === (category?.color || "green"); input.setAttribute("aria-label", color);
    label.style.setProperty("--color", colorFor(color)); label.append(input); $("colors").append(label);
  }
  $("editor").showModal(); $("stack-name").focus();
}
$("new-stack").addEventListener("click", () => openEditor());
$("edit-stack").addEventListener("click", () => openEditor(data.categories.find(item => item.id === filter)));
$("cancel").addEventListener("click", () => $("editor").close());
$("stack-form").addEventListener("submit", async event => {
  event.preventDefault();
  const fields = { name: $("stack-name").value, color: new FormData(event.currentTarget).get("color") };
  const ok = editing
    ? await request("custom-rename", { ...fields, categoryId: editing }, "Stack updated.", true)
    : await request("custom-create", { ...fields, tabIds: $("include-selected").checked ? [...selected] : [] }, "Custom stack created.", true);
  if (ok) $("editor").close();
});
$("delete-stack").addEventListener("click", async () => { if (await request("custom-remove", { categoryId: editing }, "Empty stack deleted.", true)) $("editor").close(); });
$("move").addEventListener("click", () => request("custom-assign", { categoryId: $("destination").value, tabIds: [...selected] }, "Tabs moved. Automatic website grouping is off for these tabs."));
$("release").addEventListener("click", () => request("custom-release", { tabIds: [...selected] }, "Tabs returned to automatic grouping."));
$("refresh").addEventListener("click", () => request("custom-state"));
$("organize-window").addEventListener("click", () => request("custom-organize", {}, "Website stacks organized."));
$("search").addEventListener("input", render);
$("destination").addEventListener("change", renderSelection);
$("select-all").addEventListener("change", event => { for (const tab of visibleTabs()) { if (event.target.checked) selected.add(tab.id); else selected.delete(tab.id); } render(); });
window.addEventListener("focus", () => { if (!$("editor").open) void request("custom-state"); });
void request("custom-state");
