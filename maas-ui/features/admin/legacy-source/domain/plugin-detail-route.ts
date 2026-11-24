export type PluginDetailSection = "overview" | "files" | "settings";

export type PluginDetailRoute = {
  pluginID: string;
  section: PluginDetailSection;
};

export function pluginDetailRouteFromPath(pathname: string): PluginDetailRoute | null {
  const match = pathname.match(/^\/plugins\/([^/]+)(?:\/(files|settings))?\/?$/);
  if (!match?.[1]) return null;
  try {
    const pluginID = decodeURIComponent(match[1]).trim();
    if (!pluginID || pluginID.includes("/")) return null;
    return { pluginID, section: (match[2] as PluginDetailSection | undefined) ?? "overview" };
  } catch {
    return null;
  }
}

// 静态导出没有 /plugins/<id> 动态路由，详情页改用 /plugins?plugin=<id>&section=<section>。
export function pluginDetailRouteFromQuery(pathname: string, searchParams: { get(name: string): string | null } | null): PluginDetailRoute | null {
  if (pathname.replace(/\/+$/, "") !== "/plugins") return null;
  const pluginID = searchParams?.get("plugin")?.trim() ?? "";
  if (!pluginID) return null;
  const section = searchParams?.get("section");
  return { pluginID, section: section === "files" || section === "settings" ? section : "overview" };
}

export function pluginDetailPath(pluginID: string, section: PluginDetailSection = "overview") {
  const base = `/plugins?plugin=${encodeURIComponent(pluginID)}`;
  return section === "overview" ? base : `${base}&section=${section}`;
}
