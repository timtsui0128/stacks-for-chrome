// Website stacks stay in Chrome's tab strip. Custom categories are edited in
// the compact toolbar popup; right-click keeps the direct website controls.
export function createControls(api, engine, serial, scheduleAll) {
  async function syncSettings() {
    const settings = await engine.settings();
    await Promise.all([
      api.contextMenus.update("auto", { checked: settings.autoGroup }),
      api.contextMenus.update("collapse-new", { checked: settings.collapseNew }),
      api.contextMenus.update("icon-covers", { checked: settings.iconCovers }),
      api.contextMenus.update("compact-covers", { checked: settings.iconCovers && settings.compactCovers }),
      api.action.setBadgeText({ text: settings.autoGroup ? "" : "Ⅱ" }),
      api.action.setBadgeBackgroundColor({ color: "#697386" }),
      api.action.setTitle({ title: settings.autoGroup ? "Stacks · Open, Saved & Backups" : "Stacks · Auto-grouping paused" }),
    ]);
  }

  async function setupMenus() {
    const settings = await engine.settings();
    await api.contextMenus.removeAll();
    const items = [
      { id: "custom-manage", title: "Open Stacks…" },
      { id: "organize", title: "Organize tabs in this window" },
      { id: "collapse", title: "Collapse other stacks" },
      { id: "expand", title: "Expand all stacks in this window" },
      { id: "settings", title: "Website grouping" },
      { id: "auto", parentId: "settings", title: "Automatically group tabs by website", type: "checkbox", checked: settings.autoGroup },
      { id: "collapse-new", parentId: "settings", title: "Collapse new stacks", type: "checkbox", checked: settings.collapseNew },
      { id: "icon-covers", parentId: "settings", title: "Show a website logo tab for each stack", type: "checkbox", checked: settings.iconCovers },
      { id: "compact-covers", parentId: "settings", title: "Park collapsed tabs in a minimized window", type: "checkbox", checked: settings.iconCovers && settings.compactCovers },
      { id: "repair-cover", parentId: "settings", title: "Restore this stack's website logo tab" },
      { id: "release", parentId: "settings", title: "Pause auto-grouping and ungroup this window" },
    ];
    for (const item of items) {
      await new Promise((resolve, reject) => {
        api.contextMenus.create({ ...item, contexts: ["action"] }, () => {
          const error = api.runtime.lastError;
          if (error) reject(new Error(error.message)); else resolve();
        });
      });
    }
    await syncSettings();
  }

  async function run(tab, work) {
    return serial(async () => {
      try {
        const windowId = tab?.windowId ?? (await api.windows.getLastFocused({ windowTypes: ["normal"] })).id;
        const result = await work(windowId);
        await syncSettings();
        return result;
      } catch (error) {
        await api.action.setBadgeText({ text: "!" });
        await api.action.setBadgeBackgroundColor({ color: "#b3261e" });
        await api.action.setTitle({ title: `Could not organize tabs: ${error.message} Click to retry.` });
        console.warn("Stacks:", error.message);
      }
    });
  }

  function organize(tab) {
    return run(tab, async windowId => {
      await engine.reconcile(windowId, true);
      await engine.collapse(windowId, null, true);
    });
  }

  function menu(info, tab) {
    if (info.menuItemId === "organize") return organize(tab);
    return run(tab, async windowId => {
      if (info.menuItemId === "custom-manage") {
        await api.action.openPopup({ windowId });
      } else if (info.menuItemId === "auto") {
        await engine.setSettings({ autoGroup: !!info.checked });
        if (info.checked) await scheduleAll();
      } else if (info.menuItemId === "collapse-new") {
        await engine.setSettings({ collapseNew: !!info.checked });
      } else if (info.menuItemId === "icon-covers") {
        await engine.setSettings(info.checked ? { iconCovers: true } : { iconCovers: false, compactCovers: false });
        await engine.refreshAppearance(windowId);
        await scheduleAll();
      } else if (info.menuItemId === "compact-covers") {
        if (info.checked) await engine.enableCompact(windowId);
        else await engine.setSettings({ compactCovers: false });
        await engine.refreshAppearance(windowId);
        await scheduleAll();
      } else if (info.menuItemId === "repair-cover") {
        await engine.repairCover(tab.id);
      } else if (info.menuItemId === "collapse") {
        return engine.collapse(windowId, null, true);
      } else if (info.menuItemId === "expand") {
        return engine.collapse(windowId, null, false);
      } else if (info.menuItemId === "release") {
        await engine.release(windowId);
      }
    });
  }
  return { setupMenus, organize, menu };
}
