const basePath = process.env.NEXT_PUBLIC_TOKENHUB_BASE_PATH?.trim() || "";

export function deploymentPath(path: string) {
  return basePath + path;
}

export function deploymentStorageKey(key: string) {
  return basePath ? `${key}:${basePath}` : key;
}
