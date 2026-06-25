# SuperDoc fork — `@scale/superdoc`

This is a **fork** of [`superdoc-dev/superdoc`](https://github.com/superdoc-dev/superdoc),
maintained so the al-pmo (Dune PMO) correspondence editor can use unreleased
upstream features plus a few local fixes **before** they land in an official
SuperDoc release.

The integration branch is **`release/combined-main`**. It is the branch al-pmo
links against and the branch we publish from as the private package
`@scale/superdoc`.

> If you only want the one-line answer: al-pmo's tracked-change review needs
> block-level (table/paragraph) tracked changes and a couple of fixes that are
> spread across several open upstream PRs. This branch stacks them on one base
> so we can build and consume a single package.

---

## What's on the branch

Base = upstream `main` at merge-base `75297f6a0`. On top of that, in order:

### Upstream PRs merged in

| Upstream PR | Merge marker | What it provides | Why al-pmo needs it |
|---|---|---|---|
| **#3343** (block-level tracked changes) | `dd7c3d728`, tip `851b4b9e6` | Block-level structural tracked changes for **tables and paragraphs** (`StructuralTrackChanges`, `computeStructuralDiff`, `setStructuralDiff`) | Whole-paragraph / whole-table add+remove must be reviewable as a single change, not inline text edits that leave empty blocks behind |
| **#3714** (direction) | `29918e8e9` | Auto-detect paragraph base direction (`dir="auto"`), resolve per paragraph | Correct RTL/LTR for Arabic correspondence |
| **#3758** (linked styles) | `82681a861` | "Update to match" — redefine named paragraph styles; resolve effective formatting | Style fidelity on AI-proposed drafts |
| **#3750** (context menu) | `e16a01dd7` | Open editor context menu on right-click over resize overlays | Editor UX |

> #3343 is pinned at commit **`851b4b9`** specifically — the
> *paragraph-capable* revision of the block-tracked-changes work. Earlier
> revisions only handled tables; rebasing onto `851b4b9` is what restored
> bullet/paragraph block tracking.

### Local fixes on top (NOT in any upstream PR)

| Commit | Change |
|---|---|
| `576e0cd95` | `fix(track-changes)`: use the first **non-empty** run's marks for a tracked replace (avoids a blank-run mark wiping replacement styling) |
| _(this commit)_ | `fix(track-changes)`: resolve inline **and** block tracked changes in **one atomic** accept-all / reject-all transaction — fixes the "accept-all needs two clicks" bug (see below) |
| _(this commit)_ | `chore`: scope the published package as **`@scale/superdoc`** |

#### Atomic accept-all / reject-all

`acceptAllTrackedChanges` / `rejectAllTrackedChanges` previously resolved inline
marks in one transaction and block-level (row/paragraph) changes in a second
one. The second transaction raced the first and was dropped as a mismatched
transaction, so a mixed inline+block review needed multiple clicks to fully
resolve. `dispatchReviewDecision` now accepts an `appendToTr` callback so the
block resolution (`applyRowTrackedChangeResolution`) is appended onto the **same**
transaction, with a fallback path for the block-only case.

Files:
- `packages/super-editor/src/editors/v1/extensions/track-changes/track-changes.js`

---

## How al-pmo consumes this fork

al-pmo (`ips-applications/applications/dune/al-pmo/frontend`) depends on
`@scale/superdoc`. For local development it uses a **`link:` override** in
`frontend/package.json` pointing at this working tree, so fork changes are
picked up after a rebuild — no publish needed to iterate.

The al-pmo side also carries its own **diff layer** that drives these fork
primitives (`paragraph-diff.ts`, `superdoc-adapter.ts`,
`shared-doc-canvas.tsx`): paragraph/alignment/list detection, numbering-marker
merge, and table-in-place pinning. That logic lives in al-pmo, not here — see
al-pmo's `docs/SUPERDOC_TRACKED_REPLACE_STYLE_FIX.md`.

> Longer term, much of that al-pmo diff layer overlaps with this fork's native
> `compareDocuments` + `replayDifferences` engine
> (`packages/super-editor/src/editors/v1/extensions/diffing/`), which already
> does recursive, attribute-aware diffing (alignment, lists, table rows) and
> replays it as native tracked changes. Migrating al-pmo onto that engine is a
> tracked follow-up.

---

## Working with the branch

```bash
# remotes
#   origin   = github.com/dawidbudaszewski/superdoc  (this fork)
#   upstream = github.com/superdoc-dev/superdoc       (real SuperDoc)

git checkout release/combined-main

# build the package al-pmo links against
pnpm install
pnpm --filter @scale/superdoc run build   # see packages/superdoc/package.json scripts
```

### Adding another upstream PR

```bash
git fetch upstream pull/<PR>/head:pr-<PR>
git merge --no-ff pr-<PR> -m "chore: merge pr-<PR> into combined branch"
# rebuild, relink, smoke-test in al-pmo
```

### Publishing as `@scale/superdoc`

Publish **from this branch (`release/combined-main`)** — no rebuild. The
mechanics live in al-pmo's `scripts/superdoc` (so the rename rules stay in one
place); see that folder's `README.md` → *"Manual publish from
`release/combined-main` (no rebuild)"* for the exact commands. In short:

1. `apply-scale-namespace.mjs "$PWD" <N>` — transient `@scale` rename + `-scale.N`
   version stamp (core and react get **different** base versions).
2. `pnpm install --no-frozen-lockfile` then build both `@scale/superdoc` and
   `@scale/superdoc-react`.
3. Auth to CodeArtifact and `pnpm publish` both (core first; react pins the exact
   core version).
4. `git checkout -- .` to revert the rename — the `@scale` rename is **never
   committed**.

Then in al-pmo drop the `link:` override in `frontend/package.json`, pin **both**
published `-scale.N` versions, and `pnpm install`.

---

## Status / caveats

- This branch is **ahead of upstream** and is **not** itself an upstream PR.
  The block-tracked-changes feature exists upstream as PR #3343; the combined
  branch and the local fixes do not.
- Keep the branch buildable: after any merge or fix, rebuild and smoke-test the
  al-pmo tracked-change review (bullets, signature alignment, table row
  remove, accept-all in one click).
