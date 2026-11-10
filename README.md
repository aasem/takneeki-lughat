# English–Urdu Dictionary of Scientific and Technical Terms
## فرہنگِ علمی و فنی اصطلاحات

A collective volunteer project: an open **English → Urdu dictionary of scientific and technical terms**, made to support translating science and engineering textbooks into Urdu. (`takneeki-lughat` is the repository name.)

© 2026 Asim Bakhshi · National University of Sciences and Technology (NUST)

**Live:** https://aasem.github.io/takneeki-lughat/

- Search in English or Urdu (Nastaliq or Naskh display), filter by field, browse A–Z
- Light, dark or automatic theme
- ⚑ Flag any term for changes (contributors); choose "Flagged" in the field filter to see the list
- Add or correct terms from a phone or a laptop
- Strong duplicate protection (see below)
- No server, no database, no hosting cost: the dictionary is plain JSON in this repo, served by GitHub Pages, with full Git history of who changed what

## Entry format

Each term is one line of JSON in `data/<letter>.json`:

```json
{"id":"centripetal-acceleration.physics","en":"centripetal acceleration","ur":"مرکز جو اسراع","fields":["Physics"],"note":"…","cite":"NCPUL Physics Glossary (2001), p. 10","by":"github-user","added":"…","updated":"…"}
```

| key | required | meaning |
|---|---|---|
| `en` | ✅ | English term, in natural order ("angular acceleration", not "acceleration, angular") |
| `ur` | ✅ | Urdu equivalent; alternatives separated by ` / ` |
| `fields` | ✅ | One or more subject tags: `Physics`, `Mathematics`, `General`. Add more to `FIELDS` in `assets/core.js` |
| `note` | – | Explanation, usage, etymology of the Urdu coinage |
| `cite` | – | Source / reference |
| `id`, `by`, `added`, `updated` | auto | Set by the editor |

## How students contribute

**Option A — direct editing (recommended).**
1. The maintainer adds the student as a collaborator: *Repo → Settings → Collaborators → Add people*. The student accepts the email invite.
2. The student creates a token: GitHub → *Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token*, ticks only **`public_repo`**, sets an expiry (e.g. 90 days).
3. On the dictionary page, tap **Contributor sign-in** and paste the token. It is kept only on that device.
4. Tap **Add term** (or **Edit** on any card). Saving creates a commit under the student's own GitHub name.

To remove a student: remove them as a collaborator; their token stops working for this repo immediately.

**Option B — no account setup.** Without signing in, **Add term** opens a pre-filled GitHub issue. A maintainer pastes it into the data (or runs the TSV import below).

## Duplicate protection

The same rules (in [`assets/core.js`](assets/core.js)) run in three places:

1. **While typing** — the form shows exact duplicates (blocks saving), similar terms (requires an explicit "this is different" tick), and reuse of the same Urdu word (informational).
2. **At the moment of saving** — the editor re-reads the latest data from GitHub, re-checks, and commits atomically. If someone else saved in the meantime, the commit is rejected and redone on top of their change, so two students cannot add the same term at once.
3. **On every push** — the GitHub Action `Validate dictionary` checks the whole dataset and marks the commit red if anything slips through (e.g. a manual edit).

Two terms count as the **same** (saving blocked) when they share at least one field tag and match after ignoring case, spacing, hyphens, punctuation and accents: `Co-efficient of aberration` = `coefficient of aberration`. Bracketed qualifiers and inverted forms only raise a warning, so `column (matrix)` can sit beside `column`, and `Acceleration, centripetal` is flagged against `centripetal acceleration`. A word used in several subjects with the same Urdu (e.g. *vector*) is one entry tagged with both fields. A separate entry with no field in common is allowed only after confirmation, for genuinely different senses with different Urdu.

Urdu is normalised too (Arabic ي/ك → Urdu ی/ک, diacritics and ZWNJ ignored), so search and checks are not fooled by keyboard differences.

## Maintainer tools

```bash
node scripts/validate.js         # full check (same as CI)
node scripts/validate.js --fix   # re-sort / re-format shards
node scripts/import-tsv.js words.tsv --field Physics,Mathematics --cite "Source, p. {page}" --by yourname
```

The TSV format is `english<TAB>urdu<TAB>page`. Duplicates are skipped automatically.

## Scaling

Terms are split into one file per starting letter (`data/a.json` …, `data/0.json` for digits). If one letter grows large (say over ~5 MB), add a longer prefix such as `"st"` to `data/manifest.json` and run `node scripts/validate.js --fix`; terms are routed to the longest matching prefix. This keeps the setup free well into the hundreds of thousands of terms. Close to a million terms, the in-browser copy gets heavy for phones (on the order of 150–250 MB in total), and the next step would be per-letter lazy loading or a prebuilt search index, still without a database.

## Seed data

The first 110 terms are from pages 7–11 of *Glossary of Technical Terms: Physics (English–Urdu)*, National Council for Promotion of Urdu Language, New Delhi, 2001, transcribed by hand from the scan, with page citations. Sub-entries were expanded into natural order (e.g. "Aberration — –, chromatic" → "chromatic aberration"). They should be checked against the print copy.

### Project word list (November 2026)

About 2,900 terms were imported from the team spreadsheet `english_to_urdu_words.ods` (sheet *words*), tagged **Mathematics**. These entries carry no citation. Repeated rows were merged: differing Urdu renderings are kept side by side (`… / …`), and the spreadsheet's "suggestions" column is kept in the explanation as *Suggestions*. Colour codings were not imported. Twelve rows had no Urdu (or no English) and were not imported: 350, 362, 1090, 1709, 1757, 1965, 1967, 2246, 2768, 2832, 2912, 2913.
