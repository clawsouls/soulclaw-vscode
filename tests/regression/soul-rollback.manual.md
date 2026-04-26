# Regression Test Protocol — SoulRollback

Manual walk-through Tom can run in the Extension Development Host to
verify each of the six feature components of SoulRollback. Component
③ (multi-layer contamination detection) is *also* covered by the
automated node test — this document walks the VS-Code-visible side
that the unit test can't exercise.

The automated part of ③ is:

    npx tsx tests/regression/soulscan.test.ts

which must exit 0 before starting this manual protocol.

---

## Prerequisites

- VS Code Extension Development Host on
  `feature/embedded-engine` build.
- A workspace containing at minimum `soul.json` + `SOUL.md`
  (use `tests/regression/fixtures/clean-soul/` as a starting point —
  copy it into a scratch workspace; don't mutate the fixture).
- The fixture directory `tests/regression/fixtures/contaminated-soul/`
  is used in Component ③ as a paste source.

---

## § Component ① — Checkpoint save

**Goal:** on demand, the extension writes a full snapshot of soul
files to `.clawsouls/checkpoints/<id>/` with a manifest.

1. Open the scratch workspace (clean soul).
2. In the Checkpoints panel, click **"Create Checkpoint"**.
3. Enter label `baseline-clean`.
4. Inspect on disk:

        ls .clawsouls/checkpoints/<id>/
        cat .clawsouls/checkpoints/<id>/checkpoint.json

   **Expected:**
   - The directory contains copies of every `SOUL_FILES` that
     existed in the workspace at capture time.
   - `checkpoint.json` includes `id`, `label="baseline-clean"`,
     `createdAt`, `fileCount`, `scanScore`, and a `hashes` map
     (SHA-256 per file).

**Hash verification sub-test:** manually edit any file under
`.clawsouls/checkpoints/<id>/` (append a byte). Later, in
Component ④, the restore path must refuse to load this checkpoint
with a hash-mismatch warning.

---

## § Component ② — Checkpoint history creation and management

**Goal:** multiple checkpoints accumulate in time-ordered history,
indexed by timestamp and rendered via the TreeDataProvider.

1. In the scratch workspace, create **5** checkpoints with
   distinct labels (`state-1` … `state-5`), spaced ~5 seconds
   apart so the ISO-8601 ids differ.
2. Inspect on disk:

        ls -1 .clawsouls/checkpoints/ | sort

   **Expected:** 5 directories, chronologically ordered. Each
   contains a `checkpoint.json` with `label`, `timestamp`, `id`,
   `files`, `hashes`, `score`.
3. Open the Checkpoints panel.

   **Expected:** the tree renders all 5 entries in **newest-first**
   order. Description text shows `<date> · <fileCount> files · <✅/⚠️/❌>
   <score>` per the `CheckpointNode` renderer in
   `checkpointPanel.ts`.

**Negative test (corrupt entry is skipped):** delete
`checkpoint.json` from one checkpoint dir but leave the other
files. `loadCheckpoints()` must skip it without throwing — the
other 4 still render.

(The `MAX_CHECKPOINT_HISTORY = 50` retention cap is verified
separately in the "Regression checks" section below.)

---

## § Component ③ — Multi-layer contamination-detection pipeline

**Goal:** run the multi-layer detection pipeline. The current
implementation exposes **four** layers, matching the Marketplace
README statement "Run 4-layer contamination detection on any
checkpoint":

| # | Layer | Source | When active |
|---|-------|--------|-------------|
| 1 | SECURITY (53 rules) | `SECURITY_RULES` regex battery | always |
| 2 | PII (2 rules) | `PII_RULES` regex battery | always |
| 3 | QUALITY (11 rules) | structural checks on `soul.json` / `SOUL.md` | always |
| 4 | INTEGRITY | SHA-256 match vs caller-provided `expectedHashes` | opt-in (checkpoint context) |

(The automated test `soulscan.test.ts` covers all four layers.
This manual step verifies the VS-Code-visible side.)

1. In the scratch workspace, open `SOUL.md` and paste the full
   contents of `tests/regression/fixtures/contaminated-soul/SOUL.md`
   at the bottom. Save.
2. In the SoulScan panel, click **"Run Scan"**.

   **Expected:**
   - The result header shows four layer counts:
     Security (≥3), PII (≥2), Quality (≥1), Integrity (0 or ≥1
     depending on whether the scan was invoked with checkpoint
     context).
   - Each issue row shows the correct category badge
     (SEC / PII / QUA / INT). Rule-id prefix must match the
     category — verified by the automated multi-layer separation
     test.
3. Note the `score` — it should drop well below 90 (no longer
   A-band).

**Integrity layer sub-test:** from a terminal in the scratch
workspace, run:

        npx tsx -e "const s = require('./out/engine/soulscan'); \
            console.log(s.scanSoulFiles('.', { expectedHashes: { \
            'SOUL.md': '0'.repeat(64) } }).categories);"

   **Expected:** `integrity: 1` in the printed `categories`
   object. This proves the opt-in 4th layer is wired up and
   fires on hash mismatch.

---

## § Component ④ — Contamination judgment

**Goal:** a score below `CLEAN_THRESHOLD` (= 75) causes the
checkpoint to be flagged as "not a safe restore anchor".

1. Continue from ③ — contaminated workspace.
2. Create a checkpoint named `after-contamination`.
3. Inspect `checkpoint.json` — `scanScore` should be < 75.
4. Reopen the Checkpoints panel.

   **Expected:** the `after-contamination` entry is visually
   marked as contaminated (iconography / tooltip). It must NOT
   be selected as the auto-restore target in Component ⑥.

---

## § Component ⑤ — First-contamination point identification

**Goal:** identify the point at which contamination first appeared.
This maps to the `diffCheckpoint()` command which renders
`vscode.diff(cpUri, curUri)` — the reviewer visually locates the
first point where the content became contaminated by diffing
neighboring checkpoints in history.

1. Set up a deliberate timeline (all in one scratch workspace):

   1. Start clean. Checkpoint `t0-clean`.
   2. Paste contamination. Checkpoint `t1-dirty`.
   3. Edit more contamination. Checkpoint `t2-dirtier`.
   4. (Do NOT clean up between t1 and t2.)

2. In the Checkpoints panel, right-click `t0-clean` → **"Compare
   with current"** (or invoke `clawsouls.checkpoint.diff` from the
   palette with `t0-clean` selected). Repeat for `t1-dirty`.

   **Expected:**
   - `vscode.diff` opens side-by-side with the workspace.
   - Diff vs `t0-clean` shows all contamination lines added.
   - Diff vs `t1-dirty` shows only the additional contamination
     from step 3.
   - By scanning these diffs the reviewer identifies `t1-dirty`
     as the first contaminated checkpoint and `t0-clean` as the
     most recent checkpoint **직전** (immediately preceding) the
     identified contamination.

3. Auto-restore path: run `ClawSouls: Checkpoint — Auto-Restore`
   from the palette.

   **Expected:** the extension selects `t0-clean` as the restore
   target — i.e. the checkpoint immediately preceding `t1-dirty`
   (the first contamination point). If it instead restores to
   `t2-dirtier` or silently falls through to the newest
   contaminated checkpoint, component ⑤ FAILS.

**Note on terminology:** the restore target is defined relative to
the identified contamination point, not by picking the "newest clean
anchor" in absolute terms. The two coincide whenever history is
continuously clean → dirty; if you intentionally produce a
clean → dirty → clean → dirty timeline, the spec restores to the
checkpoint directly before the *earliest* dirty one, not the
latest-clean. Document any deviation in the PASS/FAIL row.

---

## § Component ⑥ — Restore from the checkpoint immediately preceding the identified point

**Goal:** restore based on the checkpoint **immediately preceding**
the identified contamination point (as determined in §⑤). The
implementation also verifies SHA-256 hashes before overwriting,
and writes a pre-restore safety snapshot — both are hardening
additions on top of the base restore.

1. Continue from ⑤ — with `t0-clean`, `t1-dirty`, `t2-dirtier`
   in history.
2. Confirm the auto-restore dialog.

   **Expected, in order:**
   1. A new silent checkpoint `pre-restore-<timestamp>` is
      written (Component ⑥ pre-restore snapshot — verify it
      appears in the panel after restore completes).
   2. Each file pulled from `t0-clean` is hashed and compared
      against the `hashes` map. If any mismatch, restore aborts
      with a warning — test this by corrupting a file inside
      `.clawsouls/checkpoints/t0-clean/` before step 2.
   3. Soul files in the workspace are overwritten with the
      `t0-clean` contents.
   4. `clawsouls.restartGateway` is invoked. If it throws, the
      warning from the v0.8.1 fix must surface:
      `"⚠️ Checkpoint restored but engine restart failed ..."`
      — verify by stopping the gateway port first to force
      restart to fail.

3. After restore succeeds, run a fresh scan.

   **Expected:** score back in A-band (>= 90), zero security /
   PII findings.

4. Open the `pre-restore-<timestamp>` checkpoint in the panel.

   **Expected:** it contains the `t2-dirtier` state — giving
   Tom an escape hatch if the restore was itself a mistake.

---

## Regression checks (bugs fixed in v0.8.1 rollback batch)

- **Hash verification present**: delete / corrupt a single byte
  in any checkpoint file and attempt restore. Restore must
  refuse.
- **Retention cap enforced (MAX_CHECKPOINT_HISTORY = 50)**:
  Create **52** checkpoints (script it or use a heartbeat, labels
  `auto-1` … `auto-52`). Run `ls -1 .clawsouls/checkpoints/ | wc -l`
  — must return exactly 50. The two oldest (`auto-1`, `auto-2`)
  dropped on disk.
- **Pre-restore safety snapshot**: the `createCheckpointSilent`
  path MUST run before restore overwrites files.
- **Restart failure surfaced**: confirm the warning banner
  appears when `clawsouls.restartGateway` throws.

---

## Pass/Fail recording

Same format as the Swarm Memory protocol. Archive the signed
report alongside the release notes for the build under test.
