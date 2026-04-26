# Regression Test Protocol — Swarm Memory

Manual walk-through Tom can run in the Extension Development Host to
verify each of the seven feature components of Swarm Memory. The
component numbers in `§` are the normative reference — every
expected observation is tied back to one.

---

## Prerequisites

- **Two** VS Code windows open on two separate local workspaces
  (simulate two agents on one team). Call them `agent-A` and
  `agent-B`.
- Extension Development Host running `feature/embedded-engine` build.
- A temporary remote git repo reachable from both windows. Easiest:

        mkdir -p /tmp/swarm-remote && git -C /tmp/swarm-remote init --bare

  then use `file:///tmp/swarm-remote` as the swarm git URL.
- `age` binary installed (for encrypted swarm). Tests that require
  encryption mark the step explicitly; otherwise plain remote works.

---

## § Component ① — VCS-backed repository

**Goal:** prove the swarm persists to a real git repo, not just an
in-memory store.

1. In `agent-A`, open the Swarm panel and run **"Init Swarm"**.
2. Point it at `file:///tmp/swarm-remote` and accept defaults.
3. After init finishes, run:

        git -C /tmp/swarm-remote log --all --oneline

   **Expected:** at least one commit exists and one branch (the
   main branch) is visible in `branches --all`. The branch contains
   `.soulscan/swarm.json`.

---

## § Component ② — Per-agent branches

**Goal:** each agent pushes to its own isolated branch.

1. In `agent-A`, run **"Join Swarm"** with agent name `alice`.
2. In `agent-B`, run **"Join Swarm"** with agent name `bob` against
   the same `/tmp/swarm-remote`.
3. After both join:

        git -C /tmp/swarm-remote branch --all

   **Expected:** both `agent/alice` and `agent/bob` branches exist.
   Neither agent has written to the other's branch. If the extension
   falls back to `main` or to the other agent's branch for either
   push, this component FAILS — the hardened `pushWithSync` must
   reject the fallback.

---

## § Component ③ — Change detection

**Goal:** file edits in the workspace trigger a swarm sync.

1. In `agent-A`, edit `SOUL.md` and save.
2. Within ~2s, the FileSystemWatcher should commit + push to
   `agent/alice`.
3. In `agent-B`, run **"Pull Swarm"**.

   **Expected:** `SOUL.md` in `agent-B`'s workspace now shows the
   edit from `agent-A`.

**Negative test:** touch a file under `.git/`, `.soulscan/` (except
`swarm.json`), or `.age`. The watcher must NOT fire a sync for
these — they are excluded by the hardened pattern ignore list.

---

## § Component ④ — Merge into shared branch

**Goal:** agent branches merge into a common `swarm/shared` (or
`main`) branch.

1. After Components ② and ③, both agents have pushed independent
   commits.
2. In `agent-A`, run **"Sync Swarm"** (or trigger via watcher).
3. Inspect:

        git -C /tmp/swarm-remote log --all --graph --oneline

   **Expected:** a merge commit exists whose parents include both
   `agent/alice` and `agent/bob`'s heads, or both heads are
   fast-forwarded into the shared branch.

---

## § Component ⑤ — Conflict detection

**Goal:** concurrent edits to the same line are detected, not
silently clobbered.

1. In `agent-A`, edit line 5 of `SOUL.md` to `"Alice's edit"`. Save
   but do NOT wait for auto-sync — manually trigger push.
2. In `agent-B` (before pulling), edit the same line 5 to
   `"Bob's edit"`. Save and push.
3. In either agent, run **"Sync Swarm"**.

   **Expected:** the extension surfaces a conflict notification
   naming `SOUL.md`. It must NOT accept one side's change silently.

---

## § Component ⑥ — LLM-integrated resolution

**Goal:** the content-bearing conflict from ⑤ is resolved by the
configured LLM, and non-content files (binary, lock files, logs)
are auto-resolved by classifier without LLM.

1. With the conflict from ⑤ still pending, run
   **"Auto-Resolve Conflicts"**.
2. Watch the output channel.

   **Expected (content file):**
   - The panel POSTs to the configured LLM endpoint using
     `--data-binary @-` via stdin (shell injection must be
     impossible — inspect the invocation in the log).
   - The resolved `SOUL.md` merges both intents (not just
     picking one side).
   - The log reports `LLM resolved: 1` (using the explicit
     `totalConflicts` counter, not a last-write guess).

**Sub-test for classifier:** repeat ⑤ with both agents editing
`package-lock.json` instead of `SOUL.md`. Expected: the
`isNonContentFile()` classifier auto-resolves without calling the
LLM, and the log clearly labels each file as `non-content →
auto-resolved`.

---

## § Component ⑦ — Branch sync

**Goal:** after resolution in ⑥, both agents' branches are
fast-forwarded to the resolved tip.

1. After Components ⑤ + ⑥ complete.
2. In `agent-A`:

        git -C $WORKSPACE_A log agent/alice --oneline | head -3

3. In `agent-B`:

        git -C $WORKSPACE_B log agent/bob --oneline | head -3

   **Expected:** both show the same merge/resolution commit at the
   tip. Neither diverges from the shared branch.

---

## Regression checks (bugs fixed in v0.8.1 bug-fix batches)

- **Shell injection eliminated**: look at `curl` calls in the
  extension log during Component ⑥. They must show
  `--data-binary @-` and the prompt content must NEVER appear
  interpolated into the argv list.
- **Agent-branch fallback prevented**: if you simulate a push
  failure (break the remote URL temporarily), the push must
  THROW, not silently fall back to `main` or another agent's
  branch.
- **Staging scope**: when `joinAgent` runs, run
  `git status --porcelain` inside the workspace immediately
  before it commits. Only `.soulscan/swarm.json` should be
  staged, never the whole tree.
- **Deletion sync**: delete `NOTES.md` in `agent-A`'s workspace.
  After sync, `agent-B` pulling must also see `NOTES.md`
  deleted.
- **Watcher exclusions**: edit `.age` or a file under `.soulscan/`
  (other than `swarm.json`). The watcher must ignore these.

---

## Pass/Fail recording

For each of the seven components, record one of:

- `PASS` — observed behavior matches expected
- `FAIL` — observed behavior diverges (attach screenshot + log
  snippet)
- `N/A` — component could not be exercised in this environment
  (document why — e.g., `age` not installed)

Archive the signed-off report alongside the release notes for the
build under test.
