import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "docs/help-config.json"), "utf8"),
);
const articles = fs
  .readdirSync(path.join(root, "docs/help"))
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((file) => {
    const raw = fs.readFileSync(path.join(root, "docs/help", file), "utf8");
    const match = raw.match(/^<!-- help-metadata\n([\s\S]+?)\n-->\n([\s\S]*)$/);
    if (!match) throw Error("Invalid article " + file);
    const meta = JSON.parse(match[1]);
    const body = match[2].trim();
    if (
      meta.slug + ".md" !== file ||
      !Array.isArray(meta.roles) ||
      !Array.isArray(meta.features)
    )
      throw Error("Invalid metadata " + file);
    const parts = body.split(/^## /m).slice(1);
    const sections = parts.map((part, i) => {
      const newline = part.indexOf("\n");
      return {
        id: "section-" + i,
        title: part.slice(0, newline).trim(),
        text: part.slice(newline + 1).trim(),
      };
    });
    for (const screen of meta.screens)
      if (!/^\/(?!\/)/.test(screen.href)) throw Error("Invalid screen link");
    return { ...meta, body, sections };
  });
const catalog = JSON.stringify({ ...config, articles }, null, 2) + "\n";
for (const file of ["apps/web/src/lib/help/catalog.json", "apps/api/src/help/catalog.json"]) {
  const out = path.join(root, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, catalog);
}
console.log("Help articles: " + articles.length);
