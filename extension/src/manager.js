import { GROUP_COLORS } from "./styles.js";
import { stackAccent } from "./covers.js";

const $ = id => document.getElementById(id);
const sourceWindow = await chrome.windows.getCurrent({ windowTypes: ["normal"] });
let data = { tabs: [], categories: [], websites: [], savableStacks: [], library: { saved: [], backups: [] } };
let section = "open";
let itemAction = null;
let saveSources = [];
let filter = "all";
let editing = null;
let pending = null;
let loaded = false;
const selected = new Set((await chrome.tabs.query({ windowId: sourceWindow.id, highlighted: true })).map(tab => tab.id));
const NEW_STACK = "__new_stack__";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function colorFor(color) { return stackAccent({ color }).fill; }
function visibleTabs() {
  const query = $("search").value.trim().toLowerCase();
  return data.tabs.filter(tab => (filter === "all" || (filter === "automatic" ? !tab.categoryId : filter.startsWith("website:") ? !tab.categoryId && `website:${tab.siteKey}` === filter : tab.categoryId === filter))
    && (!query || `${tab.title} ${tab.url}`.toLowerCase().includes(query)));
}
function renderSelection() {
  const visible = visibleTabs();
  const busy = !!pending;
  const hiddenCount = [...selected].filter(id => !visible.some(tab => tab.id === id)).length;
  const customOnly = selected.size > 0 && [...selected].every(id => data.tabs.find(tab => tab.id === id)?.categoryId);
  $("selection-count").textContent = selected.size ? `${selected.size} selected` : "Select tabs to move";
  document.querySelector(".selection-bar").classList.toggle("has-selection", !!selected.size);
  $("move").disabled = busy || !selected.size || !$("destination").value;
  $("move").textContent = pending === "custom-assign" ? "Moving…" : "Move tabs";
  $("move").title = !selected.size ? "Select tabs first" : !$("destination").value ? "Choose a destination stack" : "Move selected tabs";
  $("destination").disabled = busy || !selected.size;
  $("release").hidden = !customOnly;
  $("release").disabled = busy;
  $("clear-selection").hidden = !selected.size;
  $("clear-selection").disabled = busy;
  $("select-all").checked = !!visible.length && visible.every(tab => selected.has(tab.id));
  $("select-all").indeterminate = visible.some(tab => selected.has(tab.id)) && !$("select-all").checked;
  $("select-all").disabled = busy || !visible.length;
  $("selection-help").textContent = hiddenCount
    ? `${hiddenCount} selected ${hiddenCount === 1 ? "tab is" : "tabs are"} outside this view.`
    : "Custom stacks stay out of automatic grouping.";
  for (const check of $("tabs").querySelectorAll("input")) check.disabled = busy;
  for (const id of ["new-stack", "edit-stack", "organize-window", "refresh", "save-stack", "cancel"]) $(id).disabled = busy;
  $("save-stack").textContent = busy ? "Saving…" : "Save stack";
  $("delete-stack").disabled = busy || data.tabs.some(tab => tab.categoryId === editing);
  $("delete-stack").title = $("delete-stack").disabled ? "Move tabs out of this stack before deleting it" : "Delete this empty stack";
  $("tabs").setAttribute("aria-busy", String(busy));
  for (const id of ["save-later", "library-action", "auto-backup", "save-confirm", "save-cancel", "item-cancel", "item-confirm", "undo", "save-source", "saved-name", "close-after-save"]) $(id).disabled = busy;
  $("save-later").disabled = busy || !data.savableStacks?.length;
  if (section === "saved") $("library-action").disabled = busy || !data.savableStacks?.length;
  for (const button of document.querySelectorAll(".sections button, .library-item button")) button.disabled = busy;
  $("undo").hidden = !data.library?.undo;
  $("undo").title = data.library?.undo ? `Undo: ${data.library.undo.label}` : "";
}
function renderFilters() {
  const options = [new Option(`All tabs · ${data.tabs.length}`, "all"), new Option(`Automatic · ${data.tabs.filter(tab => !tab.categoryId).length}`, "automatic")];
  const group = document.createElement("optgroup"); group.label = "Custom stacks";
  for (const category of data.categories) {
    const count = data.tabs.filter(tab => tab.categoryId === category.id).length;
    group.append(new Option(`${category.name} · ${count}`, category.id));
  }
  const websites = document.createElement("optgroup"); websites.label = "Websites";
  for (const site of data.websites || []) websites.append(new Option(`${site.name} · ${data.tabs.filter(tab => !tab.categoryId && tab.siteKey === site.key).length}`, `website:${site.key}`));
  $("category-filter").replaceChildren(...options, ...(websites.children.length ? [websites] : []), ...(data.categories.length ? [group] : []));
  $("category-filter").value = filter;
  const destination = $("destination").value;
  $("destination").replaceChildren(new Option("Move to a stack…", ""), ...data.categories.map(item => new Option(item.name, item.id)), new Option("＋ New stack…", NEW_STACK));
  $("destination").value = data.categories.some(item => item.id === destination) ? destination : "";
}
function render() {
  const scrollTop = $("tabs").scrollTop;
  for (const id of selected) if (!data.tabs.some(tab => tab.id === id)) selected.delete(id);
  const category = data.categories.find(item => item.id === filter);
  const website = data.websites?.find(item => `website:${item.key}` === filter);
  if (!category && !website && !["all", "automatic"].includes(filter)) filter = "all";
  $("heading").textContent = category?.name || website?.name || (filter === "automatic" ? "Automatic tabs" : "All tabs");
  $("edit-stack").hidden = !category;
  $("category-filter").title = category?.name || "Choose which tabs to view";
  document.querySelector(".view-picker .folder").style.color = category ? colorFor(category.color) : "";
  renderFilters();
  const visible = visibleTabs();
  $("tabs").replaceChildren();
  for (const tab of visible) {
    const row = element("label", "tab");
    row.title = tab.title;
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = selected.has(tab.id);
    check.setAttribute("aria-label", `Select ${tab.title}`);
    check.addEventListener("change", () => { if (check.checked) selected.add(tab.id); else selected.delete(tab.id); renderSelection(); });
    const icon = element("img", "tab-icon"); icon.alt = "";
    const favicon = new URL(chrome.runtime.getURL("_favicon/"));
    favicon.searchParams.set("pageUrl", tab.url); favicon.searchParams.set("size", "32");
    icon.src = favicon.href;
    icon.addEventListener("error", () => { icon.src = chrome.runtime.getURL("icons/32.png"); }, { once: true });
    const text = element("span", "tab-text");
    let host; try { host = new URL(tab.url).hostname || "Local file"; } catch { host = tab.website; }
    const meta = element("span", "tab-meta");
    meta.append(element("span", "tab-host", host));
    const stack = data.categories.find(item => item.id === tab.categoryId);
    if (stack) {
      const tag = element("span", "tab-category"); tag.title = stack.name;
      const dot = element("span", "dot"); dot.style.background = colorFor(stack.color);
      tag.append(dot, element("span", "", stack.name)); meta.append(tag);
    } else if (tab.parked) meta.append(element("span", "tab-state", "· Collapsed"));
    text.append(element("span", "tab-title", tab.title), meta);
    row.append(check, icon, text); $("tabs").append(row);
  }
  $("tabs").scrollTop = scrollTop;
  $("tab-count").textContent = `${visible.length} ${visible.length === 1 ? "tab" : "tabs"}`;
  $("empty").hidden = !!visible.length;
  const searching = !!$("search").value.trim();
  $("clear-search").hidden = !$("search").value;
  $("empty-title").textContent = !loaded ? "Loading your tabs…" : searching ? "No matching tabs" : category ? "This stack is empty" : "No tabs to organize";
  $("empty-description").textContent = searching ? "Try a different title or website." : category
    ? "Choose tabs from All tabs, then move them here." : "Open a webpage to get started. Pinned tabs and shared groups stay where they are.";
  $("empty-action").hidden = !loaded || (!searching && !category && filter === "all");
  $("empty-action").textContent = searching ? "Clear search" : "Show all tabs";
  renderSelection();
  renderLibrary();
}
async function request(type, fields = {}, message = "", dialog = false) {
  if (pending) return false;
  pending = type; renderSelection();
  const status = typeof dialog === "string" ? $(dialog) : dialog ? $("dialog-status") : $("status"); status.textContent = ""; status.classList.remove("error");
  try {
    const response = await chrome.runtime.sendMessage({ type, windowId: sourceWindow.id, ...fields });
    if (!response?.ok) throw new Error(response?.error || "Stacks is updating. Close and reopen this popup to reconnect.");
    data = response; loaded = true;
    if (["custom-assign", "custom-release"].includes(type) || (type === "custom-create" && fields.tabIds?.length)) selected.clear();
    render();
    $("status").classList.remove("error"); $("status").textContent = response.message || message;
    return true;
  } catch (error) {
    status.textContent = error.message; status.classList.add("error");
    if (!loaded) { $("empty-title").textContent = "Couldn't load your tabs"; $("empty-description").textContent = "Use Refresh to try again."; }
    return false;
  } finally { pending = null; renderSelection(); }
}
function openEditor(category = null) {
  if (pending) return;
  editing = category?.id || null;
  $("dialog-title").textContent = category ? "Edit custom stack" : "New custom stack";
  $("stack-name").value = category?.name || "";
  $("dialog-status").textContent = "";
  $("delete-stack").hidden = !category;
  $("include-label").hidden = !!category || !selected.size;
  $("include-text").textContent = `Include ${selected.size} selected ${selected.size === 1 ? "tab" : "tabs"}`;
  $("include-selected").checked = true;
  $("colors").replaceChildren();
  $("color-name").textContent = category?.color || "green";
  for (const color of GROUP_COLORS) {
    const label = element("label", "swatch"); label.title = color;
    const input = document.createElement("input"); input.type = "radio"; input.name = "color"; input.value = color;
    input.checked = color === (category?.color || "green"); input.setAttribute("aria-label", color);
    input.addEventListener("change", () => { $("color-name").textContent = color; });
    label.style.setProperty("--color", colorFor(color)); label.append(input, element("span", "swatch-name", color)); $("colors").append(label);
  }
  renderSelection(); $("editor").showModal(); $("stack-name").focus();
}
function changeView(value) { filter = value; $("tabs").scrollTop = 0; render(); }
function clearSearch() { $("search").value = ""; render(); $("search").focus(); }
$("new-stack").addEventListener("click", () => openEditor());
$("edit-stack").addEventListener("click", () => openEditor(data.categories.find(item => item.id === filter)));
$("cancel").addEventListener("click", () => $("editor").close());
$("editor").addEventListener("cancel", event => { if (pending) event.preventDefault(); });
$("stack-form").addEventListener("submit", async event => {
  event.preventDefault();
  const fields = { name: $("stack-name").value, color: new FormData(event.currentTarget).get("color") };
  const ok = editing
    ? await request("custom-rename", { ...fields, categoryId: editing }, "Stack updated.", true)
    : await request("custom-create", { ...fields, tabIds: $("include-selected").checked ? [...selected] : [] }, "Custom stack created.", true);
  if (ok) $("editor").close();
});
$("delete-stack").addEventListener("click", async () => { if (await request("custom-remove", { categoryId: editing }, "Empty stack deleted.", true)) $("editor").close(); });
$("move").addEventListener("click", () => request("custom-assign", { categoryId: $("destination").value, tabIds: [...selected] }, "Tabs moved to your custom stack."));
$("release").addEventListener("click", () => request("custom-release", { tabIds: [...selected] }, "Tabs returned to automatic grouping."));
$("refresh").addEventListener("click", () => request("custom-state"));
$("organize-window").addEventListener("click", () => request("custom-organize", {}, "Website stacks organized."));
$("search").addEventListener("input", () => { $("tabs").scrollTop = 0; render(); });
$("clear-search").addEventListener("click", clearSearch);
$("empty-action").addEventListener("click", () => { if ($("search").value.trim()) clearSearch(); else changeView("all"); });
$("category-filter").addEventListener("change", event => changeView(event.target.value));
$("destination").addEventListener("change", () => {
  if ($("destination").value === NEW_STACK) { $("destination").value = ""; openEditor(); }
  renderSelection();
});
$("clear-selection").addEventListener("click", () => { selected.clear(); render(); });
$("select-all").addEventListener("change", event => { for (const tab of visibleTabs()) { if (event.target.checked) selected.add(tab.id); else selected.delete(tab.id); } render(); });
function switchSection(value) {
  section = value;
  for (const name of ["open", "saved", "backups"]) {
    $("tab-" + name).setAttribute("aria-selected", String(name === section));
    $("tab-" + name).tabIndex = name === section ? 0 : -1;
  }
  $("open-panel").hidden = section !== "open";
  document.querySelector(".selection-bar").hidden = section !== "open";
  $("library-panel").hidden = section === "open";
  $("library-panel").setAttribute("aria-labelledby", "tab-" + section);
  $("new-stack").hidden = section !== "open";
  $("library-search").value = "";
  renderLibrary(); renderSelection();
}
function itemCount(item) { return item.sections.reduce((sum, stack) => sum + stack.tabs.length, 0); }
function pageCountLabel(item) { const count = itemCount(item); return `${count} ${count === 1 ? "page" : "pages"}`; }
function dateLabel(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value); }
function renderLibrary() {
  const library = data.library || { saved: [], backups: [] };
  $("saved-count").textContent = library.saved.length;
  const backups = section === "backups";
  $("library-title").textContent = backups ? "Backups" : "Saved stacks";
  $("library-subtitle").textContent = backups ? "A way back when tabs disappear." : "Ready when you are.";
  $("library-action").textContent = backups ? "Back up now" : "Save a stack";
  $("backup-setting").hidden = !backups;
  $("auto-backup").checked = !!library.enabled;
  $("library-search").placeholder = backups ? "Search backups" : "Search saved stacks";
  $("library-footnote").textContent = backups ? "Up to 20 recent backups, within local storage limits. Links only." : "Stored on this device. Links, not copies of webpages.";
  $("library-notice").textContent = library.notice || ""; $("library-notice").hidden = !library.notice;
  const query = $("library-search").value.trim().toLowerCase();
  const items = (backups ? library.backups : library.saved).filter(item => !query || `${item.name} ${item.sections.map(stack => `${stack.name} ${stack.tabs.map(tab => `${tab.title} ${tab.url}`).join(" ")}`).join(" ")}`.toLowerCase().includes(query));
  const scrollTop = $("library-list").scrollTop;
  $("library-list").replaceChildren();
  for (const item of items) {
    const row = element("div", "library-item");
    const open = element("button", "item-open");
    const dot = element("span", "dot"); dot.style.background = colorFor(item.sections[0]?.color || "grey");
    const copy = element("span", "item-copy");
    copy.append(element("strong", "", item.name), element("small", "", `${pageCountLabel(item)} · ${dateLabel(item.createdAt)}`));
    open.append(dot, copy); open.title = item.name; open.disabled = !!pending;
    open.addEventListener("click", () => openItem(item, backups ? "backups" : "saved"));
    const remove = element("button", "icon-button delete-item", "×");
    remove.setAttribute("aria-label", `Delete ${item.name}`); remove.title = "Delete saved copy"; remove.disabled = !!pending;
    remove.addEventListener("click", () => openItem(item, backups ? "backups" : "saved", true));
    row.append(open, remove); $("library-list").append(row);
  }
  $("library-list").scrollTop = scrollTop;
  $("library-empty").hidden = !!items.length;
  $("library-empty-title").textContent = query ? "No matching items" : backups ? "Your safety net starts here" : "Nothing saved yet";
  $("library-empty-description").textContent = query ? "Try a stack name, page title or website." : backups ? "Back up this window now, or keep automatic backups on for future changes." : "Save a whole stack, then reopen it whenever you need it.";
}
function updateSaveSource() {
  const stack = saveSources.find(item => item.key === $("save-source").value);
  $("saved-name").value = stack?.name || "";
  $("save-summary").textContent = stack ? `${stack.tabs.length} ${stack.tabs.length === 1 ? "page" : "pages"} will be saved on this device.` : "No savable webpages in this window.";
}
function openSave() {
  if (pending) return;
  saveSources = structuredClone(data.savableStacks || []);
  if (!saveSources.length) { $("status").textContent = "Open a webpage before saving a stack."; return; }
  $("save-source").replaceChildren(...saveSources.map(stack => new Option(`${stack.name} · ${stack.tabs.length}`, stack.key)));
  const preferred = saveSources.find(stack => stack.key === filter || stack.key === `custom:${filter}`)
    || saveSources.find(stack => stack.tabs.some(tab => selected.has(tab.id))) || saveSources[0];
  $("save-source").value = preferred.key; updateSaveSource();
  $("close-after-save").checked = false;
  $("save-confirm").textContent = "Save & keep open";
  $("save-error").textContent = "";
  $("save-dialog").showModal(); $("saved-name").focus(); $("saved-name").select();
}
function openItem(item, kind, remove = false) {
  if (pending) return;
  itemAction = { kind, id: item.id, remove };
  $("item-title").textContent = remove ? "Delete saved copy?" : item.name;
  $("item-meta").textContent = `${pageCountLabel(item)} · ${dateLabel(item.createdAt)}`;
  $("item-pages").replaceChildren();
  for (const stack of item.sections) for (const tab of stack.tabs) {
    const row = element("div", "item-page", tab.title || tab.url);
    row.append(element("small", "", `${stack.name} · ${new URL(tab.url).hostname}`)); row.title = tab.url;
    $("item-pages").append(row);
  }
  $("item-note").textContent = remove ? "This removes this saved copy from Stacks. Your open pages stay open." : "Reopens missing links in this window. Pages already open stay in their current groups. Unsaved text and scroll position are not restored.";
  $("item-confirm").textContent = remove ? "Delete copy" : "Reopen missing pages";
  $("item-confirm").classList.toggle("danger", remove);
  $("item-confirm").classList.toggle("primary", !remove);
  $("item-error").textContent = "";
  $("item-dialog").showModal();
}
for (const name of ["open", "saved", "backups"]) $("tab-" + name).addEventListener("click", () => {
  switchSection(name); void request("custom-state");
});
document.querySelector(".sections").addEventListener("keydown", event => {
  if (pending || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const names = ["open", "saved", "backups"];
  const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (names.indexOf(section) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
  switchSection(names[next]); $("tab-" + section).focus();
});
$("save-later").addEventListener("click", openSave);
$("library-action").addEventListener("click", () => section === "backups" ? request("library-backup") : openSave());
$("save-source").addEventListener("change", updateSaveSource);
$("close-after-save").addEventListener("change", () => { $("save-confirm").textContent = $("close-after-save").checked ? "Save & close tabs" : "Save & keep open"; });
$("save-cancel").addEventListener("click", () => $("save-dialog").close());
$("item-cancel").addEventListener("click", () => $("item-dialog").close());
for (const id of ["save-dialog", "item-dialog"]) $(id).addEventListener("cancel", event => { if (pending) event.preventDefault(); });
$("save-form").addEventListener("submit", async event => {
  event.preventDefault();
  const stack = saveSources.find(item => item.key === $("save-source").value);
  if (!stack) return;
  if (await request("library-save", { stackKey: stack.key, name: $("saved-name").value,
    closeTabs: $("close-after-save").checked, expected: stack.tabs.map(({ id, url }) => ({ id, url })) }, "", "save-error")) {
    $("save-dialog").close(); switchSection("saved");
  }
});
$("item-confirm").addEventListener("click", async () => {
  if (!itemAction) return;
  if (await request(itemAction.remove ? "library-remove" : "library-restore", itemAction, itemAction.remove ? "Saved copy deleted." : "", "item-error")) $("item-dialog").close();
});
$("auto-backup").addEventListener("change", () => request("library-toggle", { enabled: $("auto-backup").checked }, $("auto-backup").checked ? "Automatic local backups on." : "Automatic backups off. Existing backups are kept."));
$("undo").addEventListener("click", () => request("library-undo"));
$("library-search").addEventListener("input", renderLibrary);
window.addEventListener("focus", () => { if (!["editor", "save-dialog", "item-dialog"].some(id => $(id).open)) void request("custom-state"); });
void request("custom-state");
