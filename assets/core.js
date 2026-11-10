// Takneeki Lughat — shared core used by BOTH the web app and the CI validator.
// Any rule about what counts as a duplicate lives here, so the browser and
// GitHub Actions can never disagree.

export const SCHEMA_VERSION = 1;
export const ALLOWED_KEYS = ["id", "en", "ur", "fields", "note", "cite", "by", "added", "updated", "flag"];

// Subject tags. A term may carry several (e.g. "vector": Mathematics + Physics).
// To open a new subject, add it here — the app and the validator both read this list.
export const FIELDS = ["Physics", "Mathematics", "General"];

const DASHES = /[‐-―−]/g;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-z]/;

/** Tidy an English headword for storage (keeps case). */
export function cleanEn(s) {
  return String(s || "").normalize("NFC").replace(DASHES, "-").replace(/[ \s]+/g, " ").trim();
}

/** Tidy an Urdu equivalent for storage: unify Arabic code points to Urdu ones. */
export function cleanUr(s) {
  return String(s || "").normalize("NFC")
    .replace(/[يى]/g, "ی") // Arabic yeh / alef maksura -> Farsi/Urdu yeh
    .replace(/ك/g, "ک")        // Arabic kaf -> keheh
    .replace(/ـ/g, "")              // tatweel
    .replace(/[ \s]+/g, " ").trim();
}

const alnum = t => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

/**
 * Canonical comparison key for an English term (exact duplicates are BLOCKED on this):
 * case, accents, spaces, hyphens and punctuation are ignored ("Co-efficient" == "coefficient").
 * Bracketed qualifiers still count, so "column (matrix)" and "column" are different senses.
 */
export function enKey(s) {
  return alnum(cleanEn(s).toLowerCase());
}

/**
 * Looser key (matches only WARN): drops bracketed qualifiers and undoes glossary
 * inversion ("Acceleration, centripetal" ~ "centripetal acceleration").
 */
export function enLooseKey(s) {
  let t = cleanEn(s).toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").trim();
  const inv = t.match(/^([^,]+),\s*([^,]+)$/);
  if (inv) t = `${inv[2]} ${inv[1]}`;
  return alnum(t);
}

/** Bag-of-words key (order-free, crude plural folding) for near-duplicate warnings. */
export function enWordKey(s) {
  return cleanEn(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter(w => w && !["of", "the", "a", "an", "and"].includes(w))
    .map(w => w.length > 3 ? w.replace(/(ies)$/, "y").replace(/(es|s)$/, "") : w)
    .sort().join(" ");
}

/** Canonical comparison key for Urdu: strip diacritics, ZWNJ, spaces, punctuation. */
export function urKey(s) {
  return cleanUr(s)
    .replace(/[ً-ٰٟۖ-ۭ​-‏]/g, "")
    .replace(/[هة]/g, "ہ")
    .replace(/[\s\/،,؛۔.\-\(\)\[\]"'«»]+/g, "");
}

/** The subject tags of an entry, cleaned, de-duplicated and in FIELDS order. */
export function fieldsOf(e) {
  const raw = Array.isArray(e?.fields) ? e.fields : e?.field ? [e.field] : [];
  const out = [...new Set(raw.map(f => cleanEn(f)).filter(Boolean))];
  const rank = f => { const i = FIELDS.indexOf(f); return i < 0 ? 999 : i; };
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function slug(s) {
  return cleanEn(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "term";
}

export function makeId(en, fields = []) {
  const f = [...fields].map(slug).sort().join("-");
  return f ? `${slug(en)}.${f}` : slug(en);
}

/** Which shard file a term lives in: longest matching prefix of its key, else "0". */
export function shardFor(en, prefixes) {
  const k = enKey(en);
  let best = "0";
  for (const p of prefixes) if (p !== "0" && k.startsWith(p) && p.length > (best === "0" ? 0 : best.length)) best = p;
  return best;
}

/** Field-level validation. Returns an array of error strings (empty = valid). */
export function validateEntry(e) {
  const errs = [];
  if (!e || typeof e !== "object") return ["Entry is not an object"];
  for (const k of Object.keys(e)) if (!ALLOWED_KEYS.includes(k)) errs.push(`Unknown field "${k}"`);
  const en = cleanEn(e.en), ur = cleanUr(e.ur);
  if (!en) errs.push("English term is required");
  else if (!LATIN.test(en)) errs.push("English term must contain Latin letters");
  else if (en.length > 160) errs.push("English term is too long (max 160)");
  if (!ur) errs.push("Urdu equivalent is required");
  else if (!ARABIC_SCRIPT.test(ur)) errs.push("Urdu equivalent must be written in Urdu script");
  else if (ur.length > 240) errs.push("Urdu equivalent is too long (max 240)");
  if (!enKey(en) && en) errs.push("English term has no letters or digits");
  if (e.fields != null && !Array.isArray(e.fields)) errs.push('"fields" must be a list');
  const fs = fieldsOf(e);
  if (!fs.length) errs.push("Choose at least one field");
  for (const f of fs) if (!FIELDS.includes(f)) errs.push(`Unknown field "${f}" (allowed: ${FIELDS.join(", ")})`);
  if (e.flag != null && e.flag !== true) errs.push('"flag" must be true or absent');
  for (const [k, max] of [["note", 3000], ["cite", 600], ["by", 60]]) {
    if (e[k] != null && typeof e[k] !== "string") errs.push(`"${k}" must be text`);
    else if (e[k] && e[k].length > max) errs.push(`"${k}" is too long (max ${max})`);
  }
  return errs;
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// "absorber" vs "absorbed", "absolute zero" vs "absolute term": different words, not typos.
function onlyEndingDiffers(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(a.length, b.length) - 4;
}

/**
 * Compare a candidate entry against existing entries.
 * block: hard duplicates (same English key in the same field, or same id)
 * warn:  same English in another field, reordered words / plurals, likely typos
 * info:  the same Urdu equivalent is already used for another English term
 */
export function findConflicts(cand, entries, { ignoreId = null } = {}) {
  const out = { block: [], warn: [], info: [] };
  const k = enKey(cand.en), lk = enLooseKey(cand.en), wk = enWordKey(cand.en), fs = fieldsOf(cand), uk = urKey(cand.ur);
  if (!k) return out;
  const tol = k.length >= 10 ? 2 : k.length >= 5 ? 1 : 0;
  const id = cand.id || makeId(cand.en, fs);
  for (const e of entries) {
    if (ignoreId && e.id === ignoreId) continue;
    const ek = enKey(e.en), efs = fieldsOf(e);
    const shared = efs.filter(f => fs.includes(f));
    if (ek === k && (shared.length || !fs.length)) { out.block.push({ entry: e, why: shared.length ? `Already in the dictionary under ${shared.join(" & ")}` : "Same English term already exists" }); continue; }
    if (e.id === id) { out.block.push({ entry: e, why: "An entry with this ID already exists" }); continue; }
    if (ek === k) { out.warn.push({ entry: e, why: `Exists under ${efs.join(" & ")} — if the Urdu is the same, edit that entry and add your field instead` }); continue; }
    if (lk && enLooseKey(e.en) === lk) { out.warn.push({ entry: e, why: "Same term with a different qualifier or word order" }); continue; }
    if (wk && enWordKey(e.en) === wk) { out.warn.push({ entry: e, why: "Same words in a different order or number" }); continue; }
    if (tol && !onlyEndingDiffers(k, ek) && lev(k, ek, tol) <= tol) { out.warn.push({ entry: e, why: "Very similar spelling — possible typo" }); continue; }
    if (uk && urKey(e.ur) === uk) out.info.push({ entry: e, why: "Same Urdu equivalent used for another term" });
  }
  return out;
}

export function compareEntries(a, b) {
  return enKey(a.en).localeCompare(enKey(b.en)) || fieldsOf(a).join().localeCompare(fieldsOf(b).join()) || a.id.localeCompare(b.id);
}

/** Normalise an entry for storage (drops empty optional fields, fixes code points). */
export function normaliseEntry(e) {
  const fields = fieldsOf(e);
  const out = { id: e.id || makeId(e.en, fields), en: cleanEn(e.en), ur: cleanUr(e.ur), fields };
  for (const k of ["note", "cite", "by", "added", "updated"]) {
    const v = String(e[k] || "").replace(/\r\n/g, "\n").trim();
    if (v) out[k] = v;
  }
  if (e.flag === true) out.flag = true; // flagged by a contributor for review
  return out;
}

/** Serialise a shard: one entry per line so every Git diff is a readable one-line change. */
export function serialiseShard(entries) {
  const sorted = [...entries].sort(compareEntries);
  return sorted.length ? "[\n" + sorted.map(e => JSON.stringify(e)).join(",\n") + "\n]\n" : "[]\n";
}
