export type SavedUsage = { path: string; value: unknown };

// Traverse only saved response containers, never prompt text or parsed strings.
export function responseUsage(body: string): { records: SavedUsage[]; limited: boolean; captureTruncated: boolean } {
  const records: SavedUsage[] = [];
  let limited = false;
  let visited = 0;
  let value: unknown;
  try { value = JSON.parse(body); } catch { return { records, limited, captureTruncated: false }; }
  function visit(node: unknown, path: string, depth: number) {
    if (++visited > 1200 || depth > 12) { limited = true; return; }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (visited >= 1200) { limited = true; break; }
      const next = `${path}.${key}`;
      if ((key === "usage" || key === "usageMetadata") && child !== null && typeof child === "object") records.push({ path: next, value: child });
      else if (key === "events" || key === "data" || key === "message" || key === "response" || Array.isArray(node)) visit(child, next, depth + 1);
    }
  }
  visit(value, "$", 0);
  const captureTruncated = value !== null && typeof value === "object" && "truncated" in value && value.truncated === true;
  return { records, limited, captureTruncated };
}
