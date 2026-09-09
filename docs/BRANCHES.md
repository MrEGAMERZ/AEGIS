# Git branches (meta)

**Recorded:** 2026-09-09 on this clone.  
**Remote:** `origin` → `https://github.com/MrEGAMERZ/AEGIS.git`  
**Current checkout:** `DEV` (confirmed `git branch --show-current`).  
**Working tree:** dirty — uncommitted edits in `src/background/background.js`, `src/content/content.js`, `src/popup/*`, and three `eval/harness/*.test.js` files (not part of any branch tip below).

No `git fetch` was run for this document. Remote names are only those already in `git branch -a`. **If a branch is not listed, it was not fetched here — do not invent it.**

---

## `git branch -a` (this clone)

```
* DEV
  cursor/remove-ds-store-files
  main
  ship/vlm-gateway-and-fill
  remotes/origin/HEAD -> origin/main
  remotes/origin/main
  remotes/origin/ship/vlm-gateway-and-fill
```

**Not present locally or as a fetched remote:** `origin/DEV`, `master`. `DEV` exists **only as a local branch** in this clone.

---

## Notable branches

| Branch | Purpose (one line) | Tip | Last commit subject | Demo? |
|---|---|---|---|---|
| **`DEV`** (checked out) | Day-to-day integration branch in this clone; same commit as `ship/vlm-gateway-and-fill` | `cf2b423` 2026-09-06 | `fix: accept fill/fill_field from the VLM as type` | **Yes — use this tree for demo work**, after `bash scripts/build-dist.sh` and Load unpacked from `dist/`. Uncommitted local edits are **not** on the tip until committed. |
| **`main`** | GitHub default (`origin/HEAD`). Merge of the ship PR | `f0cf097` 2026-09-06 | `Merge pull request #2 from MrEGAMERZ/ship/vlm-gateway-and-fill` | **Yes for a clean published tree.** Same feature content as `DEV` + merge commit only. No `DEV` commits unique vs `main`. |
| **`origin/main`** | Fetched mirror of GitHub `main` | `f0cf097` (same as `main`) | same merge | Same as `main` **as last fetched**. Not re-fetched 2026-09-09. |
| **`ship/vlm-gateway-and-fill`** | Feature branch that landed the local VLM gateway, form-fill, vault, teammate port | `cf2b423` | `fix: accept fill/fill_field from the VLM as type` | Same tip as `DEV`. Prefer `DEV` or `main` for demo naming; this name is historical. |
| **`origin/ship/vlm-gateway-and-fill`** | Fetched remote of the ship branch | `cf2b423` | same | Same as local `ship/…` as last fetched. |
| **`cursor/remove-ds-store-files`** | Cursor checkpoint from an early checkout; restored Phase-2 `src/` after a stash/branch mix-up | `0b06663` 2026-08-28 | `checkpoint before checking out main` | **No.** Ancestor / recovery artifact. Do not demo from here. |

`git log --oneline main..DEV` is empty. `git log --oneline DEV..main` is only `f0cf097` (the merge). Feature files at `DEV` and `main` tips match except that merge commit.

---

## Recent history (already fetched)

### `main` / `origin/main` (`git log --oneline -10`)

```
f0cf097 Merge pull request #2 from MrEGAMERZ/ship/vlm-gateway-and-fill
cf2b423 fix: accept fill/fill_field from the VLM as type
e97d30d feat: keep document parse on-device with a local vault
96509aa docs: record the ship plan and real-gateway demo steps
0343de8 test: cover field mapper, gateway probe, and VLM timeout classify
8ad9356 feat: port on-device form fill, voice, and privacy dashboard
79ad534 feat: prefer the local gateway and keep face/NER fail-closed copy
745974a feat: add local VLM gateway for sanitized chat completions
7591696 Ship a clean AEGIS tree with only extension, eval, and docs.
b80fa57 update towards
```

### `DEV` and `ship/vlm-gateway-and-fill` (`git log --oneline -8`)

Same as `main` from `cf2b423` downward (no merge commit).

### `cursor/remove-ds-store-files` (`git log --oneline -5`)

```
0b06663 checkpoint before checking out main
31bef36 Remove tracked .DS_Store files
f7c8aa4 Merge pull request #1 from Awais-17/changesbyAWAIS
cb665f5 Create new features.md
78bec8a Update
```

---

## What was **not** visible

- Any GitHub branches never fetched (`origin/DEV` does not exist in this remotes list).
- Force-pushed or deleted remote history after the last fetch (unknown).
- Commits on other clones / other remotes.

To refresh remotes (operator, not done here): `git fetch origin` then re-read `git branch -a`.

---

## Demo recommendation

1. Stay on **`DEV`** if that is the team’s working branch (this clone).  
2. Rebuild `dist/` from the same tree you will show.  
3. Do not demo `cursor/remove-ds-store-files`.  
4. Treat uncommitted `src/` / harness edits as **not** in the branch story until someone commits them (not done in this docs pass).
