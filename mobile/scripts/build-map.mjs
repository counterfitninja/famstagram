import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(require.resolve("leaflet/dist/leaflet.css"), "utf8");
const js = readFileSync(require.resolve("leaflet/dist/leaflet.js"), "utf8");
const license = readFileSync(require.resolve("leaflet/LICENSE"), "utf8");
const template = readFileSync(path.join(root, "src", "map-template.html"), "utf8");
const html = `<!-- Leaflet license\n${license}\n-->\n` +
  template.replace("/* LEAFLET_CSS */", () => css).replace("/* LEAFLET_JS */", () => js);
mkdirSync(path.join(root, "src", "generated"), { recursive: true });
writeFileSync(path.join(root, "src", "generated", "leaflet.ts"),
  `// Generated from bundled Leaflet assets. Run npm run build:map.\nexport default ${JSON.stringify(html)};\n`);
