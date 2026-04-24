# Patent Test Protocol — APP2026-0325 (SoulRollback)

Manual walk-through Tom can run in the Extension Development Host to
verify each of the six claim components of SoulRollback. Component
③ (multi-layer contamination detection) is *also* covered by the
automated node test — this document walks the VS-Code-visible side
that the unit test can't exercise.

The automated part of ③ is:

    npx tsx tests/patent/soulscan.patent.test.ts

which must exit 0 before starting this manual protocol.

---

## Prerequisites

- VS Code Extension Development Host on
  `feature/embedded-engine` build.
- A workspace containing at minimum `soul.json` + `SOUL.md`
  (use `tests/patent/fixtures/clean-soul/` as a starting point —
  copy it into a scratch workspace; don't mutate the fixture).
- The fixture directory `tests/patent/fixtures/contaminated-soul/`
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

## § Component ② — History management

**Goal:** checkpoints accumulate in time-ordered history, and the
history is pruned to `MAX_CHECKPOINT_HISTORY` = 50.

1. With the scratch workspace, create **52 checkpoints** in a row
   (script it or use a heartbeat). Labels `auto-1` … `auto-52`.
2. After the 52nd create, inspect:

        ls .clawsouls/checkpoints/ | wc -l

   **Expected:** exactly 50 directories. The two oldest
   (`auto-1`, `auto-2`) are removed from disk.
3. Open the Checkpoints panel.

   **Expected:** the tree shows 50 entries in newest-first order.
   Newest (`auto-52`) at the top.

**Negative test:** corrupt one checkpoint dir (delete
`checkpoint.json` but leave other files). The `loadCheckpoints()`
walker must skip it without throwing — the other 49 still render.

---

## § Component ③ — Multi-layer contamination scan

This is the component the automated test covers. The
VS-Code-visible verification:

1. In the scratch workspace, open `SOUL.md` and paste the full
   contents of `tests/patent/fixtures/contaminated-soul/SOUL.md`
   at the bottom. Save.
2. In the SoulScan panel, click **"Run Scan"**.

   **Expected:**
   - The result header shows three layer counts:
     Security (≥3), PII (≥2), Quality (≥1).
   - Each issue row shows the correct category badge
     (SEC / PII / QUA). No SEC rule should render under PII.
3. Note the `score` — it should drop well below 90 (no longer
   A-band).

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

## § Component ⑤ — First-contamination identification

**Goal:** the extension walks history newest-first and identifies
the most recent contaminated checkpoint, stopping at the first
clean anchor.

1. Setup a deliberate timeline (all in one scratch workspace):

   1. Start clean. Checkpoint `t0-clean`.
   2. Paste contamination. Checkpoint `t1-dirty`.
   3. Edit more contamination. Checkpoint `t2-dirtier`.
   4. (Do NOT clean up between t1 and t2.)

2. Run the Command Palette: `ClawSouls: Checkpoint — Auto-Restore`.
3. Before it restores, the extension should log / notify:

   **Expected:** "First contamination detected at `t1-dirty`.
   Restoring from most recent clean anchor: `t0-clean`."

4. If the extension jumps over `t1-dirty` and `t2-dirtier`
   without naming them, component ⑤ FAILS — the walk is not
   identifying the *first* contamination, only the restore
   target.

---

## § Component ⑥ — Clean-checkpoint restore

**Goal:** auto-restore selects the newest checkpoint whose
`scanScore >= CLEAN_THRESHOLD` (75) and replaces the workspace
soul files with its contents. Hashes are verified. A
pre-restore safety snapshot is taken.

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
- **Retention cap enforced**: confirm 52-checkpoint scenario
  leaves exactly 50 on disk.
- **Pre-restore safety snapshot**: the `createCheckpointSilent`
  path MUST run before restore overwrites files.
- **Restart failure surfaced**: confirm the warning banner
  appears when `clawsouls.restartGateway` throws.

---

## Pass/Fail recording

Same format as the Swarm Memory protocol. File the signed
report at
`clawsouls-internal/docs/SOUL_ROLLBACK_PATENT_TEST_REPORT_<DATE>.md`
so the evidence exists if KIPO requests BLT supporting
material.
