#!/usr/bin/env node
// Bulk-import a TSV (english <TAB> urdu [<TAB> page]) into the shards,
// skipping anything that would be a duplicate.
//   node scripts/import-tsv.js FILE.tsv --field Physics,Mathematics --cite "Source, p. {page}" [--by name]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseEntry, validateEntry, findConflicts, shardFor, serialiseShard, makeId } from "../assets/core.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : ""; };
const file = argv[0];
if (!file) { console.error("usage: import-tsv.js FILE.tsv --field F --cite \"... p. {page}\" [--by NAME]"); process.exit(2); }

const manifest = JSON.parse(readFileSync(join(root, "data/manifest.json"), "utf8"));
const shards = {};
for (const p of manifest.shards) {
  const path = join(root, `data/${p}.json`);
  shards[p] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}
const now = new Date().toISOString();
let added = 0, skipped = 0;
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [en, ur, page] = line.split("\t");
  const e = normaliseEntry({
    en, ur, fields: opt("field").split(",").map(f => f.trim()).filter(Boolean), cite: (opt("cite") || "").replace("{page}", page || "?"),
    by: opt("by"), added: now, updated: now,
  });
  e.id = makeId(e.en, e.fields);
  const bad = validateEntry(e);
  if (bad.length) { console.log(`skip (invalid) ${en}: ${bad.join("; ")}`); skipped++; continue; }
  const p = shardFor(e.en, manifest.shards);
  const c = findConflicts(e, shards[p]);
  if (c.block.length) { console.log(`skip (duplicate) ${en} — ${c.block[0].why}`); skipped++; continue; }
  for (const w of c.warn) console.log(`note ${en} ≈ ${w.entry.en}: ${w.why}`);
  shards[p].push(e); added++;
}
for (const p of manifest.shards) writeFileSync(join(root, `data/${p}.json`), serialiseShard(shards[p]));
console.log(`\nadded ${added}, skipped ${skipped}`);
