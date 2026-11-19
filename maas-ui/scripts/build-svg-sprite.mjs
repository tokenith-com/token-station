import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const iconRoot = path.join(projectRoot, "icons");
const outputFile = path.join(projectRoot, "public", "icons", "sprite.svg");

if (!existsSync(iconRoot)) {
  throw new Error(`SVG icon directory does not exist: ${iconRoot}`);
}

const iconFiles = findSvgFiles(iconRoot).sort((left, right) => left.localeCompare(right));
const symbols = iconFiles.map(toSymbol);
const sprite = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
  ...symbols,
  "</svg>",
  "",
].join("\n");

mkdirSync(path.dirname(outputFile), { recursive: true });
if (!existsSync(outputFile) || readFileSync(outputFile, "utf8") !== sprite) {
  writeFileSync(outputFile, sprite, "utf8");
}

console.log(`Generated ${symbols.length} SVG icons at ${path.relative(projectRoot, outputFile)}.`);

function findSvgFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findSvgFiles(entryPath);
    return entry.isFile() && path.extname(entry.name).toLowerCase() === ".svg" ? [entryPath] : [];
  });
}

function toSymbol(filePath) {
  const relativePath = path.relative(iconRoot, filePath);
  const name = relativePath
    .slice(0, -path.extname(relativePath).length)
    .split(path.sep)
    .join("-");

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(`SVG icon names may only contain letters, numbers, hyphens and underscores: ${relativePath}`);
  }

  const source = readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();
  const svg = source.match(/^<svg\b([^>]*)>([\s\S]*?)<\/svg>$/i);
  if (!svg) throw new Error(`Invalid SVG file: ${relativePath}`);

  const rootAttributes = svg[1];
  const viewBox = attribute(rootAttributes, "viewBox") ?? inferredViewBox(rootAttributes, relativePath);
  const presentationAttributes = [
    "fill",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "fill-rule",
    "clip-rule",
  ]
    .map(key => {
      const value = attribute(rootAttributes, key);
      return value === undefined ? "" : ` ${key}="${escapeAttribute(value)}"`;
    })
    .join("");
  const content = svg[2].trim();

  return `<symbol id="icon-${name}" viewBox="${escapeAttribute(viewBox)}"${presentationAttributes}>${content}</symbol>`;
}

function attribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2];
}

function inferredViewBox(attributes, relativePath) {
  const width = numericDimension(attribute(attributes, "width"));
  const height = numericDimension(attribute(attributes, "height"));
  if (width && height) return `0 0 ${width} ${height}`;
  throw new Error(`SVG icon requires a viewBox or numeric width and height: ${relativePath}`);
}

function numericDimension(value) {
  const match = value?.match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
  return match?.[1];
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
