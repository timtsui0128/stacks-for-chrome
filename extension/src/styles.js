export const GROUP_COLORS = Object.freeze(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"]);

export function markerStyle(site, saved) {
  return {
    title: typeof saved?.title === "string" ? saved.title : site.name,
    color: GROUP_COLORS.includes(saved?.color) ? saved.color : site.color,
  };
}

export async function readMarkerStyle(api, site) {
  const { stackStyles = {} } = await api.storage.local.get("stackStyles");
  return markerStyle(site, stackStyles[site.key]);
}
