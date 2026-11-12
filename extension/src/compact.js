import { coverPresentation, coverUrl, editTabs, iconRevision, readCover } from "./covers.js";
import { groupTitle, planGroups, siteForTab, siteForUrl, isAuthenticationUrl } from "./sites.js";
import { readMarkerStyle } from "./styles.js";
import { createFocusGuard } from "./focus.js";
import { customGroupIds } from "./custom.js";

export function createCompactEngine(api, native, focusGuard = createFocusGuard()) {
  const coverBase = api.runtime.getURL("cover.html");
  const parkingUrl = api.runtime.getURL("parking.html");
  const markerUrl = token => `${parkingUrl}?stack=${token}`;

  function entry(tab) {
    const cover = readCover(tab, coverBase);
    if (cover?.compact && !tab.pinned && tab.groupId === -1) return { ...tab, ...cover };
  }

  function belongs(tab, cover, record) {
    return siteForTab(tab)?.key === cover.key || ((record?.memberIds?.includes(tab.id) || record?.memberIds?.includes(tab.openerTabId))
      && isAuthenticationUrl(tab.pendingUrl || tab.url));
  }

  async function saveRecords(records) {
    await api.storage.local.set({ compactRecovery: records });
    await api.storage.session.set({ compactStacks: records });
  }

  async function recoverAfterReload() {
    const current = await inventory();
    const saved = (await api.storage.local.get("compactRecovery")).compactRecovery || {};
    const recovered = { ...current.records };
    for (const [token, prior] of Object.entries(saved).sort((a, b) => a[1].coverIndex - b[1].coverIndex)) {
      const record = { ...prior, ...current.records[token] };
      if (record.dismissed) { recovered[token] = record; continue; }
      if (!record.memberIds?.length) continue;
      const group = lineGroup(current, { ...record, token });
      const members = current.tabs.filter(tab => record.memberIds.includes(tab.id)
        && (tab.groupId === -1 || tab.groupId === group?.id) && !tab.pinned && belongs(tab, record, record));
      if (!members.length) continue;
      const parked = members.filter(tab => tab.windowId === record.parkingWindowId);
      if (parked.length) {
        const pages = await api.tabs.query({ windowId: record.parkingWindowId });
        if (!pages.some(tab => (tab.pendingUrl || tab.url) === parkingUrl)) {
          await api.tabs.create({ windowId: record.parkingWindowId, index: 0, active: false, url: parkingUrl });
        }
        const fresh = await api.tabs.query({ windowId: record.parkingWindowId });
        if (!fresh.some(tab => (tab.pendingUrl || tab.url) === markerUrl(token))) {
          const first = fresh.find(tab => tab.id === parked[0].id);
          await api.tabs.create({ windowId: record.parkingWindowId, index: first.index, active: false, url: markerUrl(token) });
        }
      }
      const source = await api.windows.get(record.windowId).catch(() => null);
      if (!source || source.type !== "normal" || source.incognito) continue;
      let cover = current.covers.find(tab => tab.token === token);
      if (!cover) {
        const tabs = await api.tabs.query({ windowId: record.windowId });
        cover = await api.tabs.create({
          windowId: record.windowId, index: Math.min(record.coverIndex || 0, tabs.length),
          active: false, url: coverUrl(coverBase, record.key, token, true),
        });
        if (cover.groupId !== -1) await editTabs(() => api.tabs.ungroup([cover.id]));
      }
      recovered[token] = { ...record, coverId: cover.id };
    }
    await saveRecords(recovered);
  }

  async function inventory() {
    const [tabs, session, groups, recovery] = await Promise.all([
      api.tabs.query({}), api.storage.session.get("compactStacks"), api.tabGroups.query({}),
      api.storage.local.get("compactRecovery"),
    ]);
    const parkingPages = tabs.filter(tab => {
      const url = tab.pendingUrl || tab.url || "";
      return url === parkingUrl || (url.startsWith(`${parkingUrl}?stack=`)
        && /^[a-f0-9-]{36}$/.test(url.slice(parkingUrl.length + 7)));
    });
    const records = session.compactStacks || recovery.compactRecovery || {};
    const covers = tabs.map(entry).filter(Boolean);
    const custom = await customGroupIds(api, groups, tabs);
    // Only explicitly recorded groups belong to compact stacks. Renaming their
    // markers edits their saved style; unrelated native groups stay manual.
    for (const cover of covers) {
      const record = records[cover.token];
      let reattached = false;
      let group = groups.find(group => group.id === record?.lineGroupId
        && !custom.has(group.id)
        && group.windowId === cover.windowId && !group.shared
        && tabs.some(tab => tab.groupId === group.id && (records[cover.token]?.memberIds?.includes(tab.id) || records[cover.token]?.memberIds?.includes(tab.openerTabId))
          && belongs(tab, cover, records[cover.token])));
      // A browser restart assigns new group/tab IDs. The extension-owned
      // cover token plus an adjacent matching group is a durable association;
      // a group called "ChatGPT" on its own is not evidence of ownership.
      if (!group && record?.key === cover.key && record.lineTitle !== undefined) {
        const next = tabs.find(tab => tab.windowId === cover.windowId && tab.index === cover.index + 1);
        const adjacent = groups.find(item => item.id === next?.groupId && !item.shared && !custom.has(item.id)
          && item.title === record.lineTitle && item.color === record.lineColor);
        const members = adjacent && tabs.filter(tab => tab.groupId === adjacent.id);
        if (members?.length && members.every(tab => !tab.pinned && siteForTab(tab)?.key === cover.key)) { group = adjacent; reattached = true; }
      }
      if (group) records[cover.token] = { ...record, windowId: cover.windowId, coverId: cover.id, lineGroupId: group.id,
        memberIds: [...new Set([...(reattached ? [] : record?.memberIds || []), ...tabs.filter(tab => tab.groupId === group.id).map(tab => tab.id)])] };
      else if (records[cover.token]) delete records[cover.token].lineGroupId;
    }
    return {
      tabs, groups, records, parkingPages, custom,
      parking: parkingPages[0],
      covers,
    };
  }

  function parkedMarker(state, cover) {
    const url = markerUrl(cover.token);
    return state.parkingPages.find(tab => (tab.pendingUrl || tab.url) === url && tab.windowId !== cover.windowId);
  }

  function parkedTabs(state, cover) {
    const marker = parkedMarker(state, cover);
    if (!marker) return [];
    const next = state.parkingPages.find(tab => tab.windowId === marker.windowId && tab.index > marker.index);
    return state.tabs.filter(tab => tab.windowId === marker.windowId && tab.groupId === -1
      && tab.index > marker.index && (!next || tab.index < next.index)
      && belongs(tab, cover, state.records[cover.token])).sort((a, b) => a.index - b.index);
  }

  function localTabs(state, cover) {
    const groupId = lineGroup(state, cover)?.id;
    return state.tabs.filter(tab => tab.windowId === cover.windowId && (tab.groupId === -1 || tab.groupId === groupId) && !tab.pinned
      && belongs(tab, cover, state.records[cover.token])).sort((a, b) => a.index - b.index);
  }

  function lineGroup(state, cover) {
    const record = state.records[cover.token];
    return state.groups.find(group => group.id === record?.lineGroupId
      && !state.custom.has(group.id)
      && group.windowId === cover.windowId && !group.shared
      && state.tabs.some(tab => tab.groupId === group.id && (record.memberIds?.includes(tab.id) || record.memberIds?.includes(tab.openerTabId))
        && belongs(tab, cover, record)));
  }

  async function captureGroupStyle(changed) {
    const group = await api.tabGroups.get(changed.id).catch(() => null);
    if (!group || group.shared) return false;
    const state = await inventory();
    const cover = state.covers.find(cover => lineGroup(state, cover)?.id === group.id);
    if (!cover) return false;
    const record = state.records[cover.token];
    // Save expected values before applying our own changes, so these events
    // only persist edits made through Chrome's native group editor.
    if (record.lineTitle === group.title && record.lineColor === group.color) return false;
    const { stackStyles = {} } = await api.storage.local.get("stackStyles");
    await api.storage.local.set({ stackStyles: { ...stackStyles, [cover.key]: { title: group.title, color: group.color } } });
    state.records[cover.token] = { ...record, lineTitle: group.title, lineColor: group.color };
    await saveRecords(state.records);
    for (const id of new Set(state.covers.filter(entry => entry.key === cover.key).map(entry => entry.windowId))) {
      await publish(id);
    }
    return true;
  }

  async function repairCover(tabId) {
    const prefs = await native.settings();
    if (!prefs.iconCovers || !prefs.compactCovers) return native.repairCover(tabId);
    const selected = await api.tabs.get(tabId);
    const state = await inventory();
    const next = state.tabs.find(tab => tab.windowId === selected.windowId && tab.index === selected.index + 1);
    const group = state.groups.find(group => group.id === (selected.groupId !== -1 ? selected.groupId : next?.groupId));
    if (!group || group.shared) return native.repairCover(tabId);
    const members = state.tabs.filter(tab => tab.groupId === group.id).sort((a, b) => a.index - b.index);
    const { stackStyles = {} } = await api.storage.local.get("stackStyles");
    const candidates = Object.entries(stackStyles).filter(([key, style]) => style.title === group.title
      && style.color === group.color && members.length
      && members.every(tab => siteForTab(tab)?.key === key || isAuthenticationUrl(tab.pendingUrl || tab.url)));
    if (candidates.length !== 1) return native.repairCover(tabId);
    const [key] = candidates[0];
    // Explicit repair can reattach a login tab directly next to its original
    // saved class. Never absorb other identity-provider tabs in the window.
    const before = state.tabs.find(tab => tab.windowId === selected.windowId && tab.index === members[0].index - 1);
    const sameLoginEndpoint = (left, right) => {
      try {
        const a = new URL(left.pendingUrl || left.url), b = new URL(right.pendingUrl || right.url);
        return isAuthenticationUrl(a.href) && isAuthenticationUrl(b.href) && a.origin === b.origin && a.pathname === b.pathname;
      } catch { return false; }
    };
    if (before?.groupId === -1 && !before.pinned && members.some(tab => sameLoginEndpoint(before, tab))) members.unshift(before);
    if (!members.some(tab => tab.id === selected.id)) return native.repairCover(tabId);
    const existing = state.covers.find(cover => cover.key === key && cover.windowId === selected.windowId);
    const token = existing?.token || crypto.randomUUID();
    const cover = existing || await editTabs(() => api.tabs.create({ windowId: selected.windowId,
      index: members[0].index, active: false, url: coverUrl(coverBase, key, token, true) }));
    if (cover.groupId !== -1) await editTabs(() => api.tabs.ungroup([cover.id]));
    state.records[token] = { ...state.records[token], key, windowId: selected.windowId, coverId: cover.id,
      lineGroupId: group.id, lineTitle: group.title, lineColor: group.color,
      memberIds: members.map(tab => tab.id), count: members.length, collapsed: false, coverIndex: cover.index };
    await saveRecords(state.records);
    await alignMembers({ ...cover, key, token });
    await publish(selected.windowId);
  }

  async function removeLine(cover, state) {
    const group = lineGroup(state, cover);
    if (!group) return;
    const ids = state.tabs.filter(tab => tab.groupId === group.id).map(tab => tab.id);
    if (ids.length) await editTabs(() => api.tabs.ungroup(ids));
    delete state.records[cover.token].lineGroupId;
    delete state.records[cover.token].lineTitle;
    delete state.records[cover.token].lineColor;
    await saveRecords(state.records);
  }

  async function alignMembers(cover) {
    const state = await inventory();
    if (parkedTabs(state, cover).length) return;
    let group = lineGroup(state, cover);
    if (group) {
      const detach = state.tabs.filter(tab => tab.groupId === group.id && !belongs(tab, cover, state.records[cover.token])).map(tab => tab.id);
      if (detach.length) await editTabs(() => api.tabs.ungroup(detach));
    }
    const members = localTabs(state, cover);
    if (!members.length) return;
    const ids = members.filter(tab => !group || tab.groupId !== group.id).map(tab => tab.id);
    if (!group || ids.length) {
      const id = await editTabs(() => api.tabs.group(group
        ? { tabIds: ids, groupId: group.id }
        : { tabIds: members.map(tab => tab.id), createProperties: { windowId: cover.windowId } }));
      group = await api.tabGroups.get(id);
    }
    const style = await readMarkerStyle(api, siteForUrl(`https://${cover.key}/`));
    state.records[cover.token] = { ...state.records[cover.token], key: cover.key, windowId: cover.windowId,
      coverId: cover.id, lineGroupId: group.id, lineTitle: style.title, lineColor: style.color,
      memberIds: members.map(tab => tab.id) };
    await saveRecords(state.records);
    if (group.title !== style.title || group.color !== style.color || group.collapsed) {
      await editTabs(() => api.tabGroups.update(group.id, { ...style, collapsed: false }));
    }
    const first = (await api.tabs.query({ groupId: group.id })).sort((a, b) => a.index - b.index)[0];
    const current = await api.tabs.get(cover.id);
    if (first && current.index !== first.index - 1) {
      await editTabs(() => api.tabs.move(cover.id, { index: first.index - (current.index < first.index ? 1 : 0) }));
      if ((await api.tabs.get(cover.id)).groupId !== -1) await editTabs(() => api.tabs.ungroup([cover.id]));
    }
  }

  async function moveBack(cover, members) {
    if (!members.length) return;
    await editTabs(async () => {
      const index = Number.isInteger(cover.id) ? (await api.tabs.get(cover.id)).index + 1 : -1;
      return api.tabs.move(members.map(tab => tab.id), { windowId: cover.windowId, index });
    });
  }

  async function minimize(windowId) {
    // On macOS Chrome may report the previous window state during creation or
    // the minimize animation. Wait for the state change before retrying.
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await api.windows.get(windowId)).state === "minimized") return;
      await api.windows.update(windowId, { state: "minimized" });
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    if ((await api.windows.get(windowId)).state !== "minimized") throw new Error("Chrome could not minimize the parked tabs window.");
  }

  async function park(cover, members, state) {
    if (!members.length) return;
    return focusGuard.run(cover.windowId, async () => {
      // Choose our own header before moving an active page. Otherwise Chrome can
      // select a neighbour's header and accidentally open that other stack.
      const active = (await api.tabs.query({ windowId: cover.windowId, active: true }))[0];
      if (members.some(tab => tab.id === active?.id)) {
        await editTabs(() => api.tabs.update(cover.id, { active: true }));
      }
      await removeLine(cover, state);
      const existing = parkedMarker(state, cover);
      const windowId = existing?.windowId ?? state.parking?.windowId
        ?? (await editTabs(() => api.windows.create({ type: "normal", url: parkingUrl, focused: false, state: "minimized" }))).id;
      const marker = existing || await editTabs(() => api.tabs.create({ windowId, url: markerUrl(cover.token), active: false }));
      const after = parkedTabs(state, cover).at(-1) || marker;
      const ids = members.map(tab => tab.id);
      try {
        await editTabs(() => api.tabs.move(ids, { windowId, index: after.index + 1 }));
        await minimize(windowId);
      } catch (error) {
        const moved = (await api.tabs.query({ windowId })).filter(tab => ids.includes(tab.id));
        await moveBack(cover, moved);
        await alignMembers(cover);
        throw error;
      }
    });
  }

  async function tidyParking(state) {
    const anchor = state.parking;
    if (!anchor) return;
    const all = await api.tabs.query({});
    const tabs = all.filter(tab => tab.windowId === anchor.windowId);
    const liveTokens = new Set(all.map(entry).filter(Boolean).map(cover => cover.token));
    const parkingIds = new Set(state.parkingPages.map(tab => tab.id));
    const empty = tabs.filter((tab, i) => parkingIds.has(tab.id) && (tab.pendingUrl || tab.url) !== parkingUrl
      && !liveTokens.has(new URL(tab.pendingUrl || tab.url).searchParams.get("stack"))
      && (!tabs[i + 1] || parkingIds.has(tabs[i + 1].id)));
    if (empty.length) await api.tabs.remove(empty.map(tab => tab.id));
    const remaining = tabs.filter(tab => !empty.some(page => page.id === tab.id));
    // Reuse the minimized window and each live cover's empty marker. Creating
    // a new window or marker can restore the window and replay its minimize
    // animation on macOS. Remove them when their covers are closed or disabled.
    if (!liveTokens.size && remaining.length === 1 && remaining[0].url === parkingUrl) await api.tabs.remove(remaining[0].id);
  }

  async function forgetClosed(windowId, state, force) {
    for (const [token, record] of Object.entries(state.records)) {
      if (record.windowId !== windowId || state.covers.some(cover => cover.token === token)) continue;
      await removeLine({ ...record, token }, state);
      if (!record.dismissed) await moveBack({ ...record, token, id: undefined }, parkedTabs(state, { ...record, token }));
      if (force) delete state.records[token];
      else state.records[token] = { key: record.key, windowId, dismissed: true };
    }
    await saveRecords(state.records);
  }

  async function publish(windowId, state = null) {
    state ||= await inventory();
    const records = state.records;
    for (const cover of state.covers.filter(cover => cover.windowId === windowId)) {
      const parked = parkedTabs(state, cover);
      const members = [...parked, ...localTabs(state, cover)];
      if (!members.length) {
        delete records[cover.token];
        await api.tabs.remove(cover.id);
        continue;
      }
      records[cover.token] = {
        ...records[cover.token], key: cover.key, windowId, coverId: cover.id,
        count: members.length, collapsed: !!parked.length, icon: iconRevision(members),
        coverIndex: cover.index, memberIds: members.map(tab => tab.id),
        parkingWindowId: parked[0]?.windowId,
      };
    }
    await saveRecords(records);
    await tidyParking(state);
  }

  async function createEntry(windowId, bucket, oldCover) {
    const token = oldCover?.token || crypto.randomUUID();
    const url = coverUrl(coverBase, bucket.site.key, token, true);
    if (oldCover) {
      await api.tabs.update(oldCover.id, { url });
      return { ...oldCover, key: bucket.site.key, token };
    }
    const first = await api.tabs.get(bucket.tabs[0].id);
    const tab = await api.tabs.create({ windowId, index: first.index, active: false, url });
    if (tab.groupId !== -1) await api.tabs.ungroup([tab.id]);
    return { ...tab, key: bucket.site.key, token };
  }

  async function sync(windowId, prefs, organize, force = false) {
    let state = await inventory();
    await forgetClosed(windowId, state, force);
    await mergeDuplicateStacks(windowId);
    state = await inventory();
    const ctx = await native.context(windowId);
    const entries = state.covers.filter(cover => cover.windowId === windowId);
    for (const cover of entries) {
      const group = lineGroup(state, cover);
      if (group) { delete ctx.owned[group.id]; delete ctx.session[group.id]; }
    }
    const protectedAuth = new Set(ctx.tabs.filter(tab => isAuthenticationUrl(tab.pendingUrl || tab.url)
      && entries.some(cover => belongs(tab, cover, state.records[cover.token]))).map(tab => tab.id));
    const plan = planGroups(ctx.tabs.filter(tab => !(protectedAuth.has(tab.id) && isAuthenticationUrl(tab.pendingUrl || tab.url))), ctx.owned);
    if (plan.detach.length) await api.tabs.ungroup(plan.detach);
    if (organize) {
      for (const cover of entries) {
        if (plan.buckets.some(bucket => bucket.site.key === cover.key)) continue;
        const tabs = localTabs(state, cover);
        if (tabs.length) plan.buckets.push({ site: siteForUrl(`https://${cover.key}/`), tabs, groupId: null });
      }
    }

    for (const bucket of plan.buckets) {
      const owner = ctx.owned[bucket.groupId];
      if (owner?.preserveGroup) continue;
      const legacyGroup = ctx.groups.find(group => group.id === bucket.groupId);
      let cover = entries.find(cover => cover.key === bucket.site.key);
      if (legacyGroup && owner?.coverDismissed && !force && !cover) continue;
      if (!cover && !legacyGroup && (!organize || Object.values(state.records).some(record =>
        record.dismissed && record.windowId === windowId && record.key === bucket.site.key))) continue;
      const oldTab = ctx.tabs.find(tab => tab.id === owner?.coverId);
      const oldDetails = oldTab && readCover(oldTab, coverBase);
      if (!cover) cover = await createEntry(windowId, bucket, oldDetails && { ...oldTab, ...oldDetails });
      if (legacyGroup) {
        const ids = (await api.tabs.query({ groupId: legacyGroup.id })).map(tab => tab.id);
        if (ids.length) await api.tabs.ungroup(ids);
        delete ctx.session[legacyGroup.id];
        await api.storage.session.set({ ownedGroups: ctx.session });
      }

      state = await inventory();
      const parked = parkedTabs(state, cover);
      const local = localTabs(state, cover);
      const shouldPark = parked.length > 0 || (legacyGroup ? legacyGroup.collapsed : !entries.includes(cover) && prefs.collapseNew);
      if (shouldPark && (organize || legacyGroup) && !local.some(tab => tab.active)) {
        // The cover and marker survive restarts. The session record also tracks
        // the source window so closing a cover returns the same live tabs.
        state.records[cover.token] = { ...state.records[cover.token], key: cover.key, windowId, coverId: cover.id };
        await saveRecords(state.records);
        await park(cover, local, state);
      } else if (organize && parked.length && local.some(tab => tab.active)) {
        await moveBack(cover, parked);
      }
    }
    // Native group markers and lines exist only for expanded stacks.
    state = await inventory();
    for (const cover of state.covers.filter(cover => cover.windowId === windowId)) {
      const current = await inventory();
      const group = lineGroup(current, cover);
      if (group?.collapsed) await park(cover, localTabs(current, cover), current);
      else await alignMembers(cover);
    }
    await publish(windowId);
  }

  async function mergeDuplicateStacks(windowId) {
    const initial = await inventory();
    const sites = new Map();
    for (const cover of initial.covers.filter(tab => tab.windowId === windowId).sort((a, b) => a.index - b.index)) {
      if (!sites.has(cover.key)) sites.set(cover.key, []);
      sites.get(cover.key).push(cover);
    }
    for (const covers of sites.values()) {
      if (covers.length < 2) continue;
      await focusGuard.run(windowId, async () => {
        const keeper = covers[0];
        const wasCollapsed = covers.every(cover => parkedTabs(initial, cover).length > 0);
        for (const cover of covers) {
          const current = await inventory();
          await removeLine(cover, current);
          await moveBack(keeper, parkedTabs(current, cover));
        }
        const current = await inventory();
        // Remove only our duplicate synthetic tabs. All real pages survive.
        for (const cover of covers.slice(1)) delete current.records[cover.token];
        await saveRecords(current.records);
        await api.tabs.remove(covers.slice(1).map(cover => cover.id));
        await alignMembers(keeper);
        const updated = await inventory();
        const members = localTabs(updated, keeper);
        if (wasCollapsed && !members.some(tab => tab.active)) await park(keeper, members, updated);
        await publish(windowId);
      });
    }
  }

  async function restoreNative(windowId) {
    let state = await inventory();
    await forgetClosed(windowId, state, true);
    state = await inventory();
    const session = (await api.storage.session.get("ownedGroups")).ownedGroups || {};
    for (const cover of state.covers.filter(cover => cover.windowId === windowId)) {
      const parked = parkedTabs(state, cover);
      await moveBack(cover, parked);
      const members = localTabs(await inventory(), cover);
      if (!members.length) {
        await api.tabs.remove(cover.id);
      } else {
        const existing = lineGroup(await inventory(), cover);
        const groupId = await api.tabs.group(existing
          ? { tabIds: members.map(tab => tab.id), groupId: existing.id }
          : { tabIds: members.map(tab => tab.id), createProperties: { windowId } });
        const title = groupTitle(siteForUrl(`https://${cover.key}/`), members.length);
        await api.tabGroups.update(groupId, { title, collapsed: !!parked.length && !members.some(tab => tab.active) });
        session[groupId] = { key: cover.key, title, coverId: cover.id, coverToken: cover.token };
        await api.storage.session.set({ ownedGroups: session });
        await api.tabs.update(cover.id, { url: coverUrl(coverBase, cover.key, cover.token) });
      }
      delete state.records[cover.token];
    }
    await saveRecords(state.records);
    await tidyParking(state);
  }

  async function reconcile(windowId, force = false, appearanceOnly = false) {
    const state = await inventory();
    if (state.parkingPages.some(tab => tab.windowId === windowId)) {
      // Closing a parked page changes the count shown back on its cover.
      for (const source of new Set(state.covers.map(cover => cover.windowId))) await publish(source);
      await tidyParking(state);
      return;
    }
    const prefs = await native.settings();
    if (prefs.iconCovers && prefs.compactCovers) {
      return sync(windowId, prefs, force || (!appearanceOnly && prefs.autoGroup), force);
    }
    if (state.covers.some(cover => cover.windowId === windowId)) await restoreNative(windowId);
    return appearanceOnly ? native.refreshAppearance(windowId) : native.reconcile(windowId, force);
  }

  async function activate(tabId, openOnly = false) {
    const cover = entry(await api.tabs.get(tabId));
    if (!cover) return native.activate(tabId, openOnly);
    if (!cover.active) return false;
    const state = await inventory();
    const parked = parkedTabs(state, cover);
    const local = localTabs(state, cover);
    const record = state.records[cover.token] || {};
    const previous = (await api.storage.session.get("lastRealTabs")).lastRealTabs?.[cover.windowId];
    if (parked.length || openOnly) {
      const previousPage = state.tabs.find(tab => tab.id === previous && tab.windowId === cover.windowId
        && !readCover(tab, coverBase) && !local.some(member => member.id === tab.id));
      if (previousPage) {
        state.records[cover.token] = { ...record, returnTabId: previousPage.id };
        await saveRecords(state.records);
      }
      await moveBack(cover, parked);
      await alignMembers(cover);
      const members = [...parked, ...local];
      const target = members.find(tab => tab.id === record.lastMember) || members[0];
      if (target) await editTabs(() => api.tabs.update(target.id, { active: true }));
    } else if (local.length) {
      const outside = state.tabs.filter(tab => tab.windowId === cover.windowId
        && !readCover(tab, coverBase) && !local.some(member => member.id === tab.id)
        && !state.groups.some(group => group.id === tab.groupId && group.collapsed));
      const target = outside.find(tab => tab.id === record.returnTabId) || outside.find(tab => tab.id === previous) || outside[0];
      state.records[cover.token] = { ...record, key: cover.key, windowId: cover.windowId, coverId: cover.id, lastMember: previous };
      await saveRecords(state.records);
      await park(cover, local, state);
      if (target) await editTabs(() => api.tabs.update(target.id, { active: true }));
    }
    await publish(cover.windowId);
    return true;
  }

  async function coverState(tabId) {
    const cover = entry(await api.tabs.get(tabId));
    if (!cover) return native.coverState(tabId);
    const state = await inventory();
    const parked = parkedTabs(state, cover);
    const members = [...parked, ...localTabs(state, cover)];
    if (!members.length) return { ok: false };
    const site = siteForUrl(`https://${cover.key}/`);
    const style = await readMarkerStyle(api, site);
    return coverPresentation(api, { ...site, color: style.color }, members, !!parked.length, true,
      members.filter(member => siteForTab(member)?.key === cover.key));
  }

  async function collapse(windowId, groupId, collapsed) {
    if (groupId !== null) return native.collapse(windowId, groupId, collapsed);
    const state = await inventory();
    if (state.parking?.windowId === windowId) return { skipped: 0 };
    let skipped = 0;
    for (const cover of state.covers.filter(cover => cover.windowId === windowId)) {
      const current = await inventory();
      if (!collapsed) {
        await moveBack(cover, parkedTabs(current, cover));
        await alignMembers(cover);
      } else {
        const members = localTabs(current, cover);
        if (members.some(tab => tab.active)) skipped++;
        else await park(cover, members, current);
      }
    }
    const nativeResult = await native.collapse(windowId, groupId, collapsed);
    await publish(windowId);
    return { skipped: skipped + nativeResult.skipped };
  }

  async function release(windowId) {
    const state = await inventory();
    if (state.parking?.windowId === windowId) return recoverParking(state.parking.id);
    await restoreNative(windowId);
    return native.release(windowId);
  }

  async function recoverParking(tabId) {
    const state = await inventory();
    if (!state.parkingPages.some(tab => tab.id === tabId)) return { ok: false };
    await native.setSettings({ compactCovers: false, autoGroup: false });
    for (const id of new Set(state.covers.map(cover => cover.windowId))) await restoreNative(id);
    // Orphaned groups remain directly available in the parking window.
    return { ok: true };
  }

  async function enableCompact(windowId) {
    const ctx = await native.context(windowId);
    for (const group of ctx.groups) {
      if (ctx.session[group.id]) delete ctx.session[group.id].preserveGroup;
    }
    await api.storage.session.set({ ownedGroups: ctx.session });
    await native.setSettings({ iconCovers: true, compactCovers: true });
    await reconcile(windowId, true);
  }

  async function managementSnapshot(windowId) {
    const state = await inventory();
    if (state.parkingPages.some(tab => tab.windowId === windowId)) throw new Error("Open Stacks from your main Chrome window.");
    const ctx = await native.context(windowId);
    const entries = state.covers.filter(cover => cover.windowId === windowId);
    const parked = entries.flatMap(cover => parkedTabs(state, cover).map(tab => ({ ...tab, website: cover.key, parked: true })));
    const automaticGroupIds = [...Object.keys(ctx.owned).map(Number), ...entries.map(cover => lineGroup(state, cover)?.id).filter(Number.isInteger)];
    const shared = new Set(ctx.groups.filter(group => group.shared).map(group => group.id));
    const tabs = [...ctx.tabs, ...parked].filter(tab => !tab.pinned && !tab.incognito && !shared.has(tab.groupId)
      && /^(https?:|file:)/.test(tab.pendingUrl || tab.url || ""));
    return { tabs: tabs.map(tab => ({ ...tab, website: tab.website || siteForTab(tab)?.name || "Local file" })), groups: ctx.groups, automaticGroupIds };
  }

  return {
    ...native, reconcile, activate, coverState, collapse, release, recoverParking, enableCompact, recoverAfterReload, captureGroupStyle, repairCover,
    refreshAppearance: windowId => reconcile(windowId, false, true), managementSnapshot,
  };
}
