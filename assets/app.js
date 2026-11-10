import {
  FIELDS, cleanEn, cleanUr, enKey, urKey, fieldsOf, makeId, shardFor, validateEntry,
  findConflicts, normaliseEntry, serialiseShard,
} from "./core.js?v=20261110f";

// ---------------------------------------------------------------- config
const REPO = "aasem/takneeki-lughat";
const BRANCH = "main";
const API = "https://api.github.com";
const PAGE = 96;

// ---------------------------------------------------------------- state
const S = {
  manifest: null,
  shards: {},          // prefix -> entries[]
  all: [],
  q: "", field: "", letter: "",
  shown: PAGE,
  token: null, user: null,
  editing: null,       // original entry when editing
};

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const store = {
  get(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  set(k, v, persist) { try { (persist ? localStorage : sessionStorage).setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} },
};
const ARABIC = /[؀-ۿ]/;
const fmtDate = iso => { const d = new Date(iso); if (isNaN(d)) return ""; const o = { day: "numeric", month: "short" }; if (d.getFullYear() !== new Date().getFullYear()) o.year = "numeric"; return d.toLocaleDateString(undefined, o); };

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------------------------------------------------------------- GitHub API
class UserError extends Error {}

async function gh(path, { method = "GET", body, accept = "application/vnd.github+json", raw = false } = {}) {
  const headers = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).message || msg; } catch {}
    const e = new Error(`GitHub ${r.status}: ${msg}`); e.status = r.status; throw e;
  }
  return raw ? r.text() : r.status === 204 ? null : r.json();
}

/**
 * Atomic, race-safe commit. `mutate(read)` receives a reader for the *latest*
 * shard contents and returns { prefix: entries[] } to write. If someone else
 * pushes in between, the ref update is rejected (not a fast-forward) and we
 * re-read and re-check from scratch — so duplicates can't slip in via a race.
 */
async function commitShards(mutate, message) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
    const head = ref.object.sha;
    const commit = await gh(`/repos/${REPO}/git/commits/${head}`);
    const read = async p => {
      try {
        const txt = await gh(`/repos/${REPO}/contents/data/${p}.json?ref=${head}`, { accept: "application/vnd.github.raw+json", raw: true });
        return JSON.parse(txt);
      } catch (e) { if (e.status === 404) return []; throw e; }
    };
    const changed = await mutate(read);
    const tree = [];
    for (const [p, entries] of Object.entries(changed)) {
      const blob = await gh(`/repos/${REPO}/git/blobs`, { method: "POST", body: { content: serialiseShard(entries), encoding: "utf-8" } });
      tree.push({ path: `data/${p}.json`, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = await gh(`/repos/${REPO}/git/trees`, { method: "POST", body: { base_tree: commit.tree.sha, tree } });
    const newCommit = await gh(`/repos/${REPO}/git/commits`, { method: "POST", body: { message, tree: newTree.sha, parents: [head] } });
    try {
      await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: { sha: newCommit.sha, force: false } });
      return { changed, sha: newCommit.sha };
    } catch (e) {
      if (e.status === 422 && attempt < 4) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw e;
    }
  }
  throw new Error("The dictionary is busy — please try again.");
}

// ---------------------------------------------------------------- loading
async function loadData() {
  // Signed-in contributors read the exact latest commit (no Pages cache delay);
  // everyone else reads the static files served by GitHub Pages.
  let base = "data/";
  if (S.token) {
    try {
      const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
      base = `https://raw.githubusercontent.com/${REPO}/${ref.object.sha}/data/`;
    } catch {}
  }
  const get = async f => {
    try { const r = await fetch(base + f, { cache: "no-cache" }); if (!r.ok) throw 0; return r.json(); }
    catch { const r = await fetch("data/" + f, { cache: "no-cache" }); if (!r.ok) throw new Error(`Could not load ${f}`); return r.json(); }
  };
  S.manifest = await get("manifest.json");
  const lists = await Promise.all(S.manifest.shards.map(p => get(`${p}.json`).catch(() => [])));
  S.manifest.shards.forEach((p, i) => { S.shards[p] = lists[i]; });
  rebuild();
}

function rebuild() {
  S.all = Object.values(S.shards).flat();
  for (const e of S.all) { e._k = enKey(e.en); e._u = urKey(e.ur); e._t = (e.note || "").toLowerCase(); }
  const used = [...new Set([...FIELDS, ...S.all.flatMap(fieldsOf)])];
  const nFlag = S.all.filter(e => e.flag).length;
  $("#fieldFilter").replaceChildren(el("option", { value: "" }, "All fields"), ...used.map(f => el("option", { value: f, selected: f === S.field }, f)),
    el("option", { value: "__flagged", selected: S.field === "__flagged" }, `⚑ Flagged (${nFlag})`));
  $("#statTerms").textContent = S.all.length.toLocaleString();
  $("#statFields").textContent = new Set(S.all.flatMap(fieldsOf)).size;
  $("#statPeople").textContent = new Set(S.all.map(e => e.by).filter(Boolean)).size;
  renderAlpha();
  render();
}

// ---------------------------------------------------------------- search & render
function search() {
  const raw = S.q.trim();
  let list = S.all;
  if (S.field === "__flagged") list = list.filter(e => e.flag);
  else if (S.field) list = list.filter(e => fieldsOf(e).includes(S.field));
  if (!raw) {
    if (S.letter) return list.filter(e => (S.letter === "#" ? !/^[a-z]/.test(e._k) : e._k.startsWith(S.letter))).sort((a, b) => a._k.localeCompare(b._k));
    return [...list].sort((a, b) => (b.updated || "").localeCompare(a.updated || "") || a._k.localeCompare(b._k));
  }
  const scored = [];
  if (ARABIC.test(raw)) {
    const q = urKey(raw);
    for (const e of list) {
      const i = e._u.indexOf(q);
      if (i >= 0) scored.push([e._u === q ? 0 : i === 0 ? 1 : 2, e]);
      else if ((e.note || "").includes(raw)) scored.push([4, e]);
    }
  } else {
    const q = enKey(raw), ql = raw.toLowerCase();
    const words = cleanEn(raw).toLowerCase().split(/\s+/);
    for (const e of list) {
      let s = -1;
      if (q && e._k === q) s = 0;
      else if (q && e._k.startsWith(q)) s = 1;
      else if (words.every(w => e.en.toLowerCase().includes(w))) s = 2;
      else if (q && e._k.includes(q)) s = 3;
      else if (ql.length > 2 && e._t.includes(ql)) s = 5;
      if (s >= 0) scored.push([s, e]);
    }
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1]._k.length - b[1]._k.length || a[1]._k.localeCompare(b[1]._k)).map(x => x[1]);
}

function highlight(text, q) {
  if (!q || ARABIC.test(q)) return [text];
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return [text];
  return text.split(new RegExp(`(${words.join("|")})`, "gi")).map((part, i) => (i % 2 ? el("mark", {}, part) : part));
}

const ICON_FLAG = '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/></svg>';

function actionButtons(e, { labels = false } = {}) {
  const btn = (html, label, fn, cls = "") => {
    const b = el("button", { type: "button", class: cls, "aria-label": label, title: label, onclick: ev => { ev.stopPropagation(); fn(b); } });
    b.innerHTML = html + (labels ? `<span>${label}</span>` : ""); return b;
  };
  const flag = btn(ICON_FLAG, e.flag ? "Remove flag" : "Flag for changes", b => toggleFlag(e, b), "flag");
  flag.setAttribute("aria-pressed", String(!!e.flag));
  return el("div", { class: "term-actions" },
    flag,
    btn(ICON_EDIT, "Edit", () => { $("#detail").close(); openEditor(e); }),
    btn(ICON_TRASH, "Delete", b => deleteTerm(e, b), "del"));
}

function byline(e) {
  const who = e.by ? (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(e.by)
    ? el("a", { class: "by", href: `https://github.com/${e.by}`, target: "_blank", rel: "noopener", title: `${e.by} on GitHub`, onclick: ev => ev.stopPropagation() }, e.by)
    : e.by) : null;
  return el("span", { class: "meta" }, who, who && e.updated ? " · " : null, e.updated ? fmtDate(e.updated) : null);
}

// Every card has the same four rows, so all cards are the same height:
// English + tags · Urdu · one-line preview (start of the explanation) · byline + actions.
function card(e) {
  const preview = e.note ? e.note.split("\n")[0] : "";
  const more = !!e.note && (e.note.includes("\n") || e.note.length > 60);
  return el("li", {
    class: "term" + (e.flag ? " flagged" : ""), id: `t-${e.id}`, tabindex: "0",
    onclick: () => openDetail(e), onkeydown: ev => { if (ev.key === "Enter" && ev.target === ev.currentTarget) openDetail(e); },
  },
    el("div", { class: "term-row" },
      el("h3", { class: "term-en", lang: "en", title: e.en }, ...highlight(e.en, S.q.trim())),
      el("span", { class: "chips" }, fieldsOf(e).map(f => el("span", { class: "chip" }, f)))),
    el("p", { class: "term-ur", lang: "ur", dir: "rtl", title: e.ur }, e.ur),
    el("p", { class: "term-pv" + (preview ? "" : " empty") }, preview || " ", more ? el("span", { class: "pv-more" }, " · more") : null),
    el("div", { class: "term-foot" }, byline(e), actionButtons(e)));
}

function openDetail(e) {
  const d = $("#detail");
  $("#detailBody").replaceChildren(...[
    el("div", { class: "dt-head" },
      el("h3", { class: "dt-en", lang: "en" }, e.en),
      el("span", { class: "chips" }, fieldsOf(e).map(f => el("span", { class: "chip" }, f)))),
    el("p", { class: "dt-ur", lang: "ur", dir: "rtl" }, e.ur),
    e.note ? el("section", { class: "dt-sec" }, el("h4", {}, "Explanation"), el("p", { class: "dt-note" }, e.note)) : null,
    el("div", { class: "dt-foot" }, byline(e), actionButtons(e, { labels: true })),
  ].filter(Boolean));
  if (!d.open) d.showModal();
}

function render() {
  const res = search();
  const n = res.length, hw = `${n.toLocaleString()} headword${n === 1 ? "" : "s"}`;
  const scope = S.field === "__flagged" ? " · flagged for changes" : S.field ? ` · ${S.field}` : "";
  const q = S.q.trim();
  $("#resultTitle").replaceChildren(...(
    q ? [el("span", { class: "rt-main" }, `“${q}”`), el("span", { class: "rt-count" }, `${hw} found${scope}`)]
    : S.letter ? [el("span", { class: "rt-letter" }, S.letter === "#" ? "#" : S.letter.toUpperCase()), el("span", { class: "rt-count" }, `${hw}${scope}`)]
    : [el("span", { class: "rt-main" }, "Recently added"), el("span", { class: "rt-count" }, `${hw} in total${scope}`)]));
  const list = $("#results");
  if (!res.length) {
    list.replaceChildren(el("li", { class: "empty" },
      el("span", { class: "ur-inline", lang: "ur", dir: "rtl" }, "یہ اصطلاح ابھی لغت میں نہیں ہے"),
      el("p", {}, S.q.trim() ? "Not in the dictionary yet. " : "Nothing here yet. "),
      el("button", { class: "primary", type: "button", onclick: () => openEditor(null, S.q.trim()) }, S.q.trim() && !ARABIC.test(S.q) ? `Add “${S.q.trim()}”` : "Add a term")));
  } else {
    list.replaceChildren(...res.slice(0, S.shown).map(card));
  }
  $("#moreBtn").hidden = res.length <= S.shown;
  $("#moreBtn").textContent = `Show more (${(res.length - S.shown).toLocaleString()} left)`;
  $("#status").textContent = "";
}

function renderAlpha() {
  const present = new Set(S.all.map(e => (/^[a-z]/.test(e._k) ? e._k[0] : "#")));
  const letters = [..."abcdefghijklmnopqrstuvwxyz", "#"];
  $("#alpha").replaceChildren(
    el("button", { type: "button", "aria-pressed": String(!S.letter), onclick: () => setLetter("") }, "★"),
    ...letters.map(l => el("button", { type: "button", "aria-pressed": String(S.letter === l), disabled: !present.has(l), onclick: () => setLetter(l) }, l.toUpperCase())));
}
function setLetter(l) { S.letter = l; S.q = ""; $("#q").value = ""; S.shown = PAGE; renderAlpha(); render(); }

function jumpToHash() {
  const m = location.hash.match(/^#t=(.+)$/);
  if (!m) return;
  const id = decodeURIComponent(m[1]);
  const e = S.all.find(x => x.id === id);
  if (!e) return;
  S.q = e.en; $("#q").value = e.en; S.letter = ""; renderAlpha(); render();
  requestAnimationFrame(() => {
    const node = document.getElementById(`t-${id}`);
    if (node) { node.scrollIntoView({ block: "center", behavior: "smooth" }); node.classList.add("flash"); }
  });
}

// ---------------------------------------------------------------- editor
const form = $("#termForm");
const F = n => form.elements[n];

function openEditor(entry = null, prefill = "") {
  S.editing = entry;
  form.reset();
  $("#editorTitle").textContent = entry ? "Edit term" : "Add a term";
  F("en").value = entry ? entry.en : prefill;
  F("ur").value = entry ? entry.ur : "";
  let last = [];
  try { last = JSON.parse(store.get("tl.lastFields") || "[]"); } catch {}
  const pre = entry ? fieldsOf(entry) : S.field ? [S.field] : last;
  const opts = [...new Set([...FIELDS, ...pre])];
  $("#fieldTags").replaceChildren(...opts.map(f => el("label", { class: "tag" },
    el("input", { type: "checkbox", name: "fields", value: f, checked: pre.includes(f) }), el("span", {}, f))));
  F("note").value = entry?.note || "";
  $("#formError").textContent = "";
  $("#confirmBox").checked = false;
  $("#saveBtn").textContent = S.user ? (entry ? "Save changes" : "Save to dictionary") : "Suggest on GitHub";
  $("#whoSaves").textContent = S.user ? `Saving as @${S.user.login}` : "Not signed in — will open a GitHub suggestion";
  $("#editor").showModal();
  runChecks();
  setTimeout(() => (entry ? F("ur") : F("en")).focus(), 30);
}

function draftFromForm() {
  const now = new Date().toISOString();
  const o = S.editing;
  const d = normaliseEntry({
    en: F("en").value, ur: F("ur").value,
    fields: [...form.querySelectorAll('input[name="fields"]:checked')].map(i => i.value),
    note: F("note").value,
    by: o ? o.by || S.user?.login : S.user?.login, added: o?.added || now, updated: now,
  });
  d.id = makeId(d.en, d.fields);
  return d;
}

let checkTimer;
function runChecks() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    const d = draftFromForm();
    const box = $("#checks");
    const errs = validateEntry(d).filter(m => (F("en").value || F("ur").value) || !/required/.test(m));
    const c = d.en ? findConflicts(d, S.all, { ignoreId: S.editing?.id }) : { block: [], warn: [], info: [] };
    // Unchanged edit? nothing to save.
    const same = S.editing && ["en", "ur", "note"].every(k => (S.editing[k] || "") === (d[k] || "")) && fieldsOf(S.editing).join() === d.fields.join();
    const sec = (cls, icon, title, items) => items.length ? el("div", { class: `check ${cls}` },
      el("h4", {}, icon, " ", title),
      el("ul", {}, items.slice(0, 6).map(({ entry, why }) => el("li", {},
        el("strong", {}, entry.en), el("span", { class: "ur-inline", lang: "ur", dir: "rtl" }, entry.ur),
        el("small", {}, `${fieldsOf(entry).join(" & ")} — ${why}`))))) : null;
    const parts = [
      errs.length && (F("en").value || F("ur").value) ? el("div", { class: "check block" }, el("h4", {}, "⚠ Fix before saving"), el("ul", {}, errs.map(m => el("li", {}, m)))) : null,
      sec("block", "⛔", "Already in the dictionary — cannot add again", c.block),
      sec("warn", "⚠", "Similar terms exist — please check", c.warn),
      sec("info", "ℹ", "Same Urdu used elsewhere (fine for synonyms)", c.info),
    ].filter(Boolean);
    if (!parts.length && d.en && d.ur && !errs.length) parts.push(el("div", { class: "check ok" }, el("h4", {}, "✓ No duplicates found")));
    box.replaceChildren(...parts);
    $("#confirmRow").hidden = !c.warn.length || !!c.block.length;
    const blocked = !!errs.length || !!c.block.length || !d.en || !d.ur || same || (c.warn.length && !$("#confirmBox").checked);
    $("#saveBtn").disabled = blocked;
    if (c.block.length) {
      const b = el("button", { type: "button", class: "link", onclick: () => { $("#editor").close(); openEditor(c.block[0].entry); } }, "Edit the existing entry instead");
      box.querySelector(".check.block:last-of-type")?.append(b);
    }
  }, 120);
}
form.addEventListener("input", runChecks);
$("#confirmBox").addEventListener("change", runChecks);

form.addEventListener("submit", async ev => {
  ev.preventDefault();
  const d = draftFromForm();
  const errs = validateEntry(d);
  if (errs.length) { $("#formError").textContent = errs.join(". "); return; }
  store.set("tl.lastFields", JSON.stringify(d.fields), true);
  if (!S.user) return suggestViaIssue(d);
  const btn = $("#saveBtn"); btn.disabled = true; btn.textContent = "Saving…";
  try { await saveEntry(d, S.editing); $("#editor").close(); }
  catch (e) { $("#formError").textContent = e instanceof UserError ? e.message : `Could not save: ${e.message}`; }
  finally { btn.textContent = S.editing ? "Save changes" : "Save to dictionary"; runChecks(); }
});

async function saveEntry(draft, original) {
  const prefixes = S.manifest.shards;
  const toP = shardFor(draft.en, prefixes);
  const fromP = original ? shardFor(original.en, prefixes) : toP;
  const verb = original ? "Edit" : "Add";
  const { changed } = await commitShards(async read => {
    const target = await read(toP);
    const source = fromP === toP ? target : await read(fromP);
    if (original) {
      const i = source.findIndex(e => e.id === original.id);
      if (i < 0) throw new UserError("Someone else has renamed or removed this term since you opened it. Close this form and reload the page.");
      if ((source[i].updated || "") !== (original.updated || "")) throw new UserError(`@${source[i].by || "someone"} changed this term after you opened it. Reload the page to see their version, then edit again.`);
      if (source[i].flag) draft.flag = true; // an edit keeps the flag; contributors unflag explicitly
      source.splice(i, 1);
    }
    const c = findConflicts(draft, target);
    if (c.block.length) throw new UserError(`Duplicate: “${c.block[0].entry.en}” was just added by @${c.block[0].entry.by || "someone"}. Nothing was saved.`);
    target.push(draft);
    return fromP === toP ? { [toP]: target } : { [toP]: target, [fromP]: source };
  }, `${verb}: ${draft.en} → ${draft.ur}${draft.fields.length ? ` [${draft.fields.join(", ")}]` : ""}\n\nvia web editor`);
  for (const [p, entries] of Object.entries(changed)) S.shards[p] = entries;
  rebuild();
  toast(original ? "Changes saved ✓" : `“${draft.en}” added ✓`);
  location.hash = `t=${encodeURIComponent(draft.id)}`;
  jumpToHash();
}

// Two-tap delete: the first tap arms the button for 4 s, the second deletes.
async function deleteTerm(e, button) {
  if (!S.user) { toast("Sign in as a contributor to delete terms"); return; }
  if (button.disabled) return;
  if (!button.classList.contains("armed")) {
    button.classList.add("armed"); button.title = "Tap again to delete";
    toast(`Tap the delete icon again to delete “${e.en}”`);
    clearTimeout(button._t); button._t = setTimeout(() => { button.classList.remove("armed"); button.title = "Delete"; }, 4000);
    return;
  }
  clearTimeout(button._t); button.disabled = true;
  const p = shardFor(e.en, S.manifest.shards);
  try {
    const { changed } = await commitShards(async read => {
      const list = await read(p);
      const i = list.findIndex(y => y.id === e.id);
      if (i < 0) throw new UserError("This term was already removed or renamed by someone else — reload the page.");
      if ((list[i].updated || "") !== (e.updated || "")) throw new UserError(`@${list[i].by || "someone"} changed this term just now — reload the page and check before deleting.`);
      list.splice(i, 1);
      return { [p]: list };
    }, `Delete: ${e.en} → ${e.ur}\n\nvia web editor`);
    S.shards[p] = changed[p]; rebuild();
    $("#detail").close();
    toast(`“${e.en}” deleted`);
  } catch (err) {
    button.disabled = false; button.classList.remove("armed"); button.title = "Delete";
    toast(err instanceof UserError ? err.message : `Could not delete: ${err.message}`, 5000);
  }
}

async function toggleFlag(e, button) {
  if (!S.user) { toast("Sign in as a contributor to flag terms"); return; }
  if (button.disabled) return;
  const on = !e.flag;
  button.disabled = true; button.setAttribute("aria-pressed", String(on)); button.closest(".term")?.classList.toggle("flagged", on);
  const p = shardFor(e.en, S.manifest.shards);
  try {
    const { changed } = await commitShards(async read => {
      const list = await read(p);
      const x = list.find(y => y.id === e.id);
      if (!x) throw new UserError("This term was changed by someone else — reload the page.");
      if (on) x.flag = true; else delete x.flag;
      return { [p]: list };
    }, `${on ? "Flag" : "Unflag"}: ${e.en}\n\nvia web editor`);
    S.shards[p] = changed[p]; rebuild();
    if ($("#detail").open) { const x = S.all.find(y => y.id === e.id); x ? openDetail(x) : $("#detail").close(); }
    toast(on ? "Flagged for changes ⚑" : "Flag removed");
  } catch (err) {
    button.setAttribute("aria-pressed", String(!on)); button.closest(".term")?.classList.toggle("flagged", !on);
    toast(err instanceof UserError ? err.message : `Could not update flag: ${err.message}`, 5000);
  } finally { button.disabled = false; }
}

function suggestViaIssue(d) {
  const { by, added, updated, ...clean } = d;
  const title = `${S.editing ? "Correction" : "New term"}: ${d.en} — ${d.ur}`;
  const body = [
    S.editing ? `Correction for existing entry \`${S.editing.id}\`.` : "Suggested new term.",
    "", "```json", JSON.stringify(clean, null, 2), "```", "",
    "_Submitted from the Takneeki Lughat web page. A maintainer will review and add it._",
  ].join("\n");
  const url = `https://github.com/${REPO}/issues/new?labels=term-suggestion&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener");
  $("#editor").close();
  toast("Opened a GitHub suggestion — submit it there");
}

// ---------------------------------------------------------------- sign-in
async function verifyToken(token) {
  S.token = token;
  const user = await gh("/user");
  const repo = await gh(`/repos/${REPO}`);
  if (!repo.permissions?.push) { S.token = null; throw new UserError(`@${user.login} doesn't have write access to ${REPO} yet. Ask your instructor to add you as a collaborator (and accept the email invitation).`); }
  S.user = user;
  return user;
}
function updateSignInUi() {
  $("#signInLabel").textContent = S.user ? `@${S.user.login}` : "Contributor sign-in";
  $("#signOutBtn").hidden = !S.user;
  $("#verifyBtn").textContent = S.user ? "Update token" : "Verify & sign in";
}
$("#signInBtn").addEventListener("click", () => { $("#signinError").textContent = ""; $("#tokenInput").value = ""; $("#signin").showModal(); });
$("#signinForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const tok = $("#tokenInput").value.trim();
  if (!tok) { $("#signinError").textContent = "Paste your token first."; return; }
  $("#verifyBtn").disabled = true; $("#signinError").textContent = "";
  try {
    const u = await verifyToken(tok);
    store.del("tl.token"); store.set("tl.token", tok, $("#rememberBox").checked);
    updateSignInUi(); $("#signin").close(); toast(`Signed in as @${u.login}`);
    loadData().catch(() => {});
  } catch (e) {
    S.token = null; S.user = null;
    $("#signinError").textContent = e instanceof UserError ? e.message : e.status === 401 ? "That token was not accepted by GitHub. Check it was copied fully and hasn't expired." : e.message;
  } finally { $("#verifyBtn").disabled = false; }
});
$("#signOutBtn").addEventListener("click", () => { store.del("tl.token"); S.token = null; S.user = null; updateSignInUi(); $("#signin").close(); toast("Signed out"); });
document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));

// ---------------------------------------------------------------- misc UI
let qTimer;
$("#q").addEventListener("input", e => {
  clearTimeout(qTimer);
  e.target.classList.toggle("is-ur", ARABIC.test(e.target.value));
  qTimer = setTimeout(() => { S.q = e.target.value; S.letter = ""; S.shown = PAGE; renderAlpha(); render(); }, 90);
});
$("#fieldFilter").addEventListener("change", e => { S.field = e.target.value; S.shown = PAGE; render(); });
$("#moreBtn").addEventListener("click", () => { S.shown += PAGE * 2; render(); });
$("#addBtn").addEventListener("click", () => openEditor(null, ARABIC.test(S.q) ? "" : S.q.trim()));
// Theme: auto (follow device) → light → dark
const THEMES = ["auto", "light", "dark"];
const applyTheme = () => {
  const t = store.get("tl.theme") || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  const label = { auto: "Theme: automatic", light: "Theme: light", dark: "Theme: dark" }[t];
  $("#themeToggle").setAttribute("aria-label", label); $("#themeToggle").title = label;
  $("#themeToggle").innerHTML = t === "light"
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : t === "dark" ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>';
};
$("#themeToggle").addEventListener("click", () => {
  const t = store.get("tl.theme") || "auto";
  store.set("tl.theme", THEMES[(THEMES.indexOf(t) + 1) % 3], true); applyTheme();
  toast($("#themeToggle").title);
});
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector("dialog[open]")) { e.preventDefault(); $("#q").focus(); }
});
const applyScript = () => {
  const naskh = store.get("tl.script") === "naskh";
  document.documentElement.classList.toggle("naskh", naskh);
  $("#scriptToggle .ur-inline").textContent = naskh ? "نسخ" : "نستعلیق";
};
$("#scriptToggle").addEventListener("click", () => { store.set("tl.script", store.get("tl.script") === "naskh" ? "nastaliq" : "naskh", true); applyScript(); });
window.addEventListener("hashchange", jumpToHash);
$("#detail").addEventListener("click", ev => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); }); // tap outside closes

// ---------------------------------------------------------------- boot
(async function boot() {
  applyScript(); applyTheme();
  const tok = store.get("tl.token");
  if (tok) { try { await verifyToken(tok); } catch { S.token = null; S.user = null; } }
  updateSignInUi();
  try { await loadData(); jumpToHash(); }
  catch (e) { $("#status").textContent = `Could not load the dictionary (${e.message}). If you opened this file directly, serve the folder over http.`; }
})();
