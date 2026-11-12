const name = document.querySelector("#name");
const status = document.querySelector("#status");
const open = document.querySelector("#open");
let refreshing = false;
let again = false;
async function refresh() {
  if (refreshing) { again = true; return; }
  refreshing = true;
  try {
    const state = await chrome.runtime.sendMessage({ type: "cover-state" });
    if (!state?.ok) {
      status.textContent = state?.error || "This stack was moved or ungrouped. Your original tabs are unaffected.";
      open.hidden = true;
      return;
    }
    document.title = state.title;
    name.textContent = state.name;
    status.textContent = `${state.count} ${state.count === 1 ? "tab" : "tabs"} ${state.collapsed ? "collapsed" : "expanded"}. Your pages are still open.`;
    open.hidden = false;
    if (state.icon) {
      const favicon = document.querySelector("#site-icon");
      const mark = document.querySelector("#site-mark");
      if (mark.getAttribute("src") !== state.icon) mark.setAttribute("src", state.icon);
      if (favicon.getAttribute("href") !== state.favicon) favicon.setAttribute("href", state.favicon);
    }
  } catch {
    status.textContent = "Stacks is updating. Please try again shortly.";
  } finally {
    refreshing = false;
    if (again) { again = false; void refresh(); }
  }
}
const token = new URL(location.href).searchParams.get("stack");
const compact = new URL(location.href).searchParams.get("compact") === "1";
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  const change = changes[compact ? "compactStacks" : "ownedGroups"];
  if (!change) return;
  const ownRecord = records => compact ? records?.[token]
    : Object.values(records || {}).find(record => record.coverToken === token);
  // Focus/Undo changes and other stacks must not queue a favicon render for
  // every control tab ahead of the user's next expand/collapse click.
  if (JSON.stringify(ownRecord(change.oldValue)) !== JSON.stringify(ownRecord(change.newValue))) void refresh();
});
open.addEventListener("click", () => { void chrome.runtime.sendMessage({ type: "cover-open" }).then(refresh); });
// Activation is handled once by the worker. Visibility can also change when
// Chrome focuses a window or parks tabs; it is not a second click signal.
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
void refresh();

