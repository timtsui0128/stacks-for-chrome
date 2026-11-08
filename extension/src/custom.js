import { GROUP_COLORS } from "./styles.js";
import { editTabs } from "./covers.js";

export async function customGroupIds(api, groups, tabs) {
  const { customBindings = {} } = await api.storage.local.get("customBindings");
  return new Set(groups.filter(group => {
    const binding = customBindings[group.id];
    return binding && binding.windowId === group.windowId
      && tabs.some(tab => tab.groupId === group.id && binding.memberIds.includes(tab.id));
  }).map(group => group.id));
}

export function createCustomManager(api, engine, focusGuard) {
  async function catalog() {
    const { customCategories = [], customBindings = {} } = await api.storage.local.get(["customCategories", "customBindings"]);
    return { categories: customCategories, bindings: customBindings };
  }
  async function save(data) {
    await api.storage.local.set({ customCategories: data.categories, customBindings: data.bindings });
  }
  function details(name, color) {
    name = typeof name === "string" ? name.trim() : "";
    if (!name || name.length > 80) throw new Error("Enter a stack name between 1 and 80 characters.");
    if (!GROUP_COLORS.includes(color)) throw new Error("Choose a Chrome group color.");
    return { name, color };
  }
  function bind(data, group, category, members) {
    data.bindings[group.id] = { categoryId: category.id, windowId: group.windowId, memberIds: members.map(tab => tab.id) };
  }
  async function state(windowId) {
    const snapshot = await engine.managementSnapshot(windowId);
    const data = await catalog();
    const custom = snapshot.groups.filter(group => !snapshot.automaticGroupIds.includes(group.id) && !group.shared);
    for (const group of custom) {
      const members = snapshot.tabs.filter(tab => tab.groupId === group.id);
      let category = data.categories.find(item => item.id === data.bindings[group.id]?.categoryId);
      if (!category) {
        const matches = data.categories.filter(item => item.name === (group.title || "Untitled stack") && item.color === group.color);
        category = matches.length === 1 ? matches[0] : null;
      }
      if (!category) {
        category = { id: crypto.randomUUID(), name: group.title || "Untitled stack", color: group.color };
        data.categories.push(category);
      }
      // Chrome's native editor remains authoritative for an existing group.
      category.name = group.title || "Untitled stack";
      category.color = group.color;
      bind(data, group, category, members);
    }
    const live = new Set((await api.tabGroups.query({})).map(group => String(group.id)));
    for (const id of Object.keys(data.bindings)) if (!live.has(id)) delete data.bindings[id];
    await save(data);
    const groupCategories = Object.fromEntries(custom.map(group => [group.id, data.bindings[group.id]?.categoryId]));
    return {
      ok: true, windowId, categories: data.categories,
      tabs: snapshot.tabs.map(tab => ({
        id: tab.id, title: tab.title || tab.url || "Untitled tab", url: tab.url || "",
        categoryId: groupCategories[tab.groupId] || null,
        website: tab.website, parked: !!tab.parked,
      })),
    };
  }

  async function create(windowId, name, color, tabIds = []) {
    const category = { id: crypto.randomUUID(), ...details(name, color) };
    const data = await catalog();
    data.categories.push(category);
    await save(data);
    if (tabIds.length) await assign(windowId, category.id, tabIds);
    return state(windowId);
  }

  async function assign(windowId, categoryId, tabIds) {
    if (!Array.isArray(tabIds) || !tabIds.length) throw new Error("Select at least one tab.");
    await state(windowId);
    const data = await catalog();
    const category = data.categories.find(item => item.id === categoryId);
    if (!category) throw new Error("This custom stack no longer exists. Refresh and try again.");
    const snapshot = await engine.managementSnapshot(windowId);
    const selected = [...new Set(tabIds)].map(id => snapshot.tabs.find(tab => tab.id === id));
    if (selected.some(tab => !tab)) throw new Error("Some tabs moved or closed. Refresh and select them again.");
    const existing = snapshot.groups.find(group => !snapshot.automaticGroupIds.includes(group.id)
      && !group.shared && data.bindings[group.id]?.categoryId === categoryId);
    // Group first, including parked tabs, so automatic website matching can
    // never adopt a temporarily ungrouped tab. Preserve the same live pages.
    await focusGuard.run(windowId, async () => {
      const groupId = await editTabs(() => api.tabs.group(existing
        ? { tabIds: selected.map(tab => tab.id), groupId: existing.id }
        : { tabIds: selected.map(tab => tab.id), createProperties: { windowId } }));
      const members = await api.tabs.query({ groupId });
      bind(data, { id: groupId, windowId }, category, members);
      await save(data);
      await editTabs(() => api.tabGroups.update(groupId, { title: category.name, color: category.color, collapsed: false }));
      await engine.refreshAppearance(windowId);
    });
    return state(windowId);
  }

  async function rename(windowId, categoryId, name, color) {
    await state(windowId);
    const data = await catalog();
    const category = data.categories.find(item => item.id === categoryId);
    if (!category) throw new Error("This custom stack no longer exists.");
    Object.assign(category, details(name, color));
    const groups = await api.tabGroups.query({});
    const tabs = await api.tabs.query({});
    const owned = await customGroupIds(api, groups, tabs);
    for (const group of groups) if (owned.has(group.id) && data.bindings[group.id]?.categoryId === categoryId && !group.shared) {
      await editTabs(() => api.tabGroups.update(group.id, { title: name.trim(), color }));
    }
    await save(data);
    return state(windowId);
  }

  async function release(windowId, tabIds) {
    const current = await state(windowId);
    if (!Array.isArray(tabIds) || !tabIds.length) throw new Error("Select at least one tab.");
    const selected = [...new Set(tabIds)].map(id => current.tabs.find(tab => tab.id === id && tab.categoryId));
    if (selected.some(tab => !tab)) throw new Error("Select tabs in a custom stack to return to automatic grouping.");
    await editTabs(() => api.tabs.ungroup(selected.map(tab => tab.id)));
    await engine.reconcile(windowId);
    return state(windowId);
  }

  async function remove(windowId, categoryId) {
    await state(windowId);
    const data = await catalog();
    const groups = await api.tabGroups.query({});
    const tabs = await api.tabs.query({});
    const ids = await customGroupIds(api, groups, tabs);
    if (groups.some(group => ids.has(group.id) && data.bindings[group.id]?.categoryId === categoryId)) {
      throw new Error("Move this stack's tabs elsewhere before deleting it.");
    }
    data.categories = data.categories.filter(item => item.id !== categoryId);
    await save(data);
    return state(windowId);
  }
  return { state, create, assign, rename, release, remove };
}
