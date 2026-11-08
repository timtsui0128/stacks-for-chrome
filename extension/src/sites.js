import { readCover } from "./covers.js";

// Exact hostnames keep distinct services (and hosted projects) separate.
// Aliases are explicit: never guess a parent domain by dropping labels.
const SITES = {
  "chatgpt.com": { name: "ChatGPT", mark: "G", color: "green", tone: "mint" },
  "claude.ai": { name: "Claude", mark: "✳", color: "orange", tone: "peach" },
  "gemini.google.com": { name: "Gemini", mark: "✦", color: "blue", tone: "blue" },
  "arxiv.org": { name: "arXiv", mark: "aχ", color: "red", tone: "rose" },
  "scholar.google.com": { name: "Google Scholar", mark: "S", color: "blue", tone: "blue" },
  "notion.so": { name: "Notion", mark: "N", color: "grey", tone: "neutral" },
  "github.com": { name: "GitHub", mark: "↗", color: "purple", tone: "lavender" },
  "youtube.com": { name: "YouTube", mark: "▶", color: "red", tone: "rose" },
  "nature.com": { name: "Nature", mark: "n", color: "green", tone: "mint" },
  "google.com": { name: "Google" },
  "info.arxiv.org": { name: "arXiv Info" },
  "canvas.manchester.ac.uk": { name: "Canvas" },
};
const ALIASES = { "chat.openai.com": "chatgpt.com" };
export const DEFAULT_SETTINGS = Object.freeze({ autoGroup: true, collapseNew: true, iconCovers: true, compactCovers: false });

export function siteForUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return null;
    const key = ALIASES[host] || host;
    return { key, name: key, mark: key[0].toUpperCase(), color: "blue", tone: "blue", ...SITES[key] };
  } catch { return null; }
}

export function siteForTab(tab) {
  return siteForUrl(tab.pendingUrl || tab.url);
}

// Retain only existing stack members during identity-provider redirects.
// An unrelated login tab must never be assigned to a website by its host alone.
export function isAuthenticationUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return ["login.microsoftonline.com", "login.windows.net", "login.live.com", "accounts.google.com", "auth.openai.com", "login.manchester.ac.uk", "login.canvas.manchester.ac.uk"].includes(url.hostname)
      || url.hostname.endsWith(".auth0.com");
  } catch { return false; }
}

export function groupLabel(site) { return `⧉ ${site.name}`; }
export function groupTitle(site, count) { return `${groupLabel(site)} · ${count}`; }

// Session IDs survive worker suspension, but not a browser restart. Recover only
// previously registered titles whose members all match the registered website.
export function resolveOwnership(tabs, groups, session = {}, knownSites = {}, coverBase) {
  const owned = {};
  for (const group of groups) {
    if (group.shared) continue;
    const existing = session[group.id];
    if (existing) {
      if (group.title === existing.title || group.title === existing.nextTitle) {
        owned[group.id] = { ...existing, title: group.title };
        delete owned[group.id].nextTitle;
      }
      // A manual rename relinquishes control for the rest of this session.
      continue;
    }
    const members = tabs.filter(tab => tab.groupId === group.id);
    const label = /^(⧉ .+) · [1-9]\d*$/.exec(group.title)?.[1];
    // Keep legacy exact titles readable when upgrading from 0.2.0.
    const key = knownSites[group.title] || (label && knownSites[label]);
    if (key && members.length && members.every(tab => siteForTab(tab)?.key === key)) {
      owned[group.id] = { key, title: group.title };
    }
  }
  // After a browser restart IDs change. Recover only a blank native group
  // immediately following our own cover, with matching website members.
  for (const tab of tabs) {
    const cover = readCover(tab, coverBase);
    if (!cover || cover.compact || tab.groupId !== -1 || tab.pinned) continue;
    const next = tabs.find(candidate => candidate.index === tab.index + 1);
    const group = groups.find(candidate => candidate.id === next?.groupId);
    if (!group || group.shared || group.title !== "" || owned[group.id] || session[group.id]) continue;
    const members = tabs.filter(candidate => candidate.groupId === group.id);
    if (members.length && members.every(member => siteForTab(member)?.key === cover.key)) {
      owned[group.id] = { key: cover.key, title: "", coverToken: cover.token, coverId: tab.id, windowId: tab.windowId };
    }
  }
  return owned;
}

export function planGroups(tabs, owned) {
  const buckets = new Map();
  const detach = [];
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    if (!Number.isInteger(tab.id) || tab.id < 0) continue;
    const site = siteForTab(tab);
    const owner = owned[tab.groupId];
    if (owner && (tab.pinned || !site || site.key !== owner.key)) detach.push(tab.id);
    if (tab.pinned || !site || (tab.groupId !== -1 && !owner)) continue;
    if (!buckets.has(site.key)) buckets.set(site.key, { site, tabs: [], groupId: null });
    const bucket = buckets.get(site.key);
    bucket.tabs.push(tab);
    if (owner?.key === site.key && bucket.groupId === null) bucket.groupId = tab.groupId;
  }
  return {
    detach,
    buckets: [...buckets.values()].filter(bucket => bucket.tabs.length >= 2 || bucket.groupId !== null),
  };
}
