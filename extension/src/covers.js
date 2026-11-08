import { badgedIcon, stableSiteIcon } from "./cover-icon.js";

// The entry is a real browser tab. Its favicon comes from Chrome's local cache.
export function readCover(tab, base) {
  if (!base) return null;
  try {
    const url = new URL(tab.pendingUrl || tab.url);
    if (`${url.protocol}//${url.host}${url.pathname}` !== base) return null;
    const key = url.searchParams.get("site");
    const token = url.searchParams.get("stack");
    if (!key || !/^[a-z0-9.-]+$/.test(key) || !token || !/^[a-z0-9-]{16,64}$/.test(token)) return null;
    return { key, token, compact: url.searchParams.get("compact") === "1" };
  } catch { return null; }
}

export function coverUrl(base, key, token, compact = false) {
  const url = new URL(base);
  url.searchParams.set("site", key);
  url.searchParams.set("stack", token);
  if (compact) url.searchParams.set("compact", "1");
  return url.href;
}

export function stackAccent(site) {
  const colors = {
    blue: "#2369b3", green: "#337d61", purple: "#8057af", orange: "#b56e2c",
    red: "#b94b4b", pink: "#b44e87", cyan: "#23818e", yellow: "#9a7819", grey: "#626873",
  };
  const color = Object.hasOwn(colors, site.color) ? site.color : "blue";
  return { color, fill: colors[color] };
}

export async function coverPresentation(api, site, members, collapsed, decorated = false, iconMembers = members) {
  const source = iconMembers.find(member => member.favIconUrl) || iconMembers[0];
  const icon = new URL(api.runtime.getURL("_favicon/"));
  icon.searchParams.set("pageUrl", source?.url || `https://${site.key}/`);
  icon.searchParams.set("size", "32");
  icon.searchParams.set("v", iconRevision(iconMembers));
  if (decorated) icon.searchParams.set("forceEmptyDefaultFavicon", "1");
  const label = `${site.name} · ${members.length}`;
  const accent = decorated ? stackAccent(site) : null;
  const stableIcon = decorated ? await stableSiteIcon(api, site.key, icon.href, !iconMembers.length) : icon.href;
  return {
    ok: true, name: site.name, count: members.length, collapsed, icon: stableIcon,
    title: decorated ? `${collapsed ? "▸" : "▾"} ${label}` : label,
    accent,
    favicon: accent ? await badgedIcon(stableIcon, accent.fill, collapsed) : stableIcon,
  };
}

export async function editTabs(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= 39 || !error.message.includes("Tabs cannot be edited right now")) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

export function iconRevision(members) {
  const source = members.find(tab => tab.favIconUrl) || members[0];
  let hash = 2166136261;
  for (const char of `${source?.id}:${source?.favIconUrl || ""}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
