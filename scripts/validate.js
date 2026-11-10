#!/usr/bin/env node
// Validates every shard in data/: schema, shard placement, unique IDs and
// duplicate terms (same canonical English key in the same field), using the
// exact same rules as the web app (assets/core.js).
//
//   node scripts/validate.js          # check; exit 1 on errors
//   node scripts/validate.js --fix    # also re-sort / re-format shards in place
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateEntry, shardFor, enKey, fieldsOf, enWordKey, serialiseShard, normaliseEntry,
} from "../assets/core.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fix = process.argv.includes("--fix");
const gha = !!process.env.GITHUB_ACTIONS;
let errors = 0, warnings = 0;
const err = (file, msg) => { errors++; console.log(gha ? `::error file=${file}::${msg}` : `ERROR  ${file}: ${msg}`); };
const warn = (file, msg) => { warnings++; console.log(gha ? `::warning file=${file}::${msg}` : `warn   ${file}: ${msg}`); };

const manifest = JSON.parse(readFileSync(join(root, "data/manifest.json"), "utf8"));
const prefixes = manifest.shards;
const ids = new Map(), keys = new Map(), words = new Map();
let total = 0;

for (const p of prefixes) {
  const rel = `data/${p}.json`, path = join(root, rel);
  if (!existsSync(path)) { err(rel, "Shard listed in manifest but file is missing"); continue; }
  const raw = readFileSync(path, "utf8");
  let list;
  try { list = JSON.parse(raw); } catch (e) { err(rel, `Invalid JSON: ${e.message}`); continue; }
  if (!Array.isArray(list)) { err(rel, "Shard must be a JSON array"); continue; }
  list.forEach((e, i) => {
    const where = `${e && e.en ? `“${e.en}”` : `#${i}`}`;
    for (const m of validateEntry(e)) err(rel, `${where}: ${m}`);
    if (!e || !e.id) { err(rel, `${where}: missing id`); return; }
    if (shardFor(e.en, prefixes) !== p) err(rel, `${where}: belongs in data/${shardFor(e.en, prefixes)}.json`);
    if (ids.has(e.id)) err(rel, `${where}: duplicate id "${e.id}" (also in ${ids.get(e.id)})`);
    ids.set(e.id, rel);
    // Duplicate = same canonical English key sharing at least one field tag.
    const k = enKey(e.en), fs = fieldsOf(e);
    // One entry per English term (multiple subjects = multiple tags on that entry).
    for (const prev of keys.get(k) || []) err(rel, `${where}: DUPLICATE of “${prev.en}” (${prev.id}) — merge into one entry and tag both fields`);
    keys.set(k, [...(keys.get(k) || []), e]);
    const w = enWordKey(e.en);
    if (words.has(w) && enKey(words.get(w).en) !== k) warn(rel, `${where}: possible duplicate of “${words.get(w).en}” (same words)`);
    else words.set(w, e);
  });
  total += list.length;
  const canonical = serialiseShard(list.map(normaliseEntry));
  if (canonical !== raw) {
    if (fix) { writeFileSync(path, canonical); console.log(`fixed  ${rel}: re-sorted / re-formatted`); }
    else warn(rel, "Not in canonical order/format — run `node scripts/validate.js --fix`");
  }
}

console.log(`\n${total} terms in ${prefixes.length} shards — ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
