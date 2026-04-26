# Regression Test Suite

End-to-end coverage for the two feature areas that have the highest
risk of silent regression:

- **Swarm Memory** — VCS-based collective agent memory (push / pull / merge)
- **SoulRollback** — multi-layer contamination detection + auto-restore

Goal: a reviewer can read one of the protocols and mechanically
reproduce each feature against the current `feature/embedded-engine`
build.

---

## What's here

| File | Type | What it covers |
|------|------|----------------|
| `soulscan.test.ts` | Automated (node:test) | Multi-layer contamination detection (SEC / PII / QUA / INT) |
| `swarm-memory.manual.md` | Manual protocol | All 7 Swarm Memory feature components |
| `soul-rollback.manual.md` | Manual protocol | All 6 SoulRollback feature components |
| `fixtures/clean-soul/` | Fixture | Baseline well-formed soul — zero findings expected |
| `fixtures/contaminated-soul/` | Fixture | Triggers SEC + PII + QUA layers — used by unit test AND manual ③ |

---

## Running the automated test

Zero dev-dependency install required:

    npx tsx tests/regression/soulscan.test.ts

`tsx` is fetched on demand by `npx -y tsx …`. Exit code 0 means
every assertion held. The suite covers:

1. Clean fixture → zero SEC, zero PII, A-band score.
2. Contaminated fixture → SEC layer fires.
3. Contaminated fixture → PII layer fires with correct category.
4. Contaminated fixture → QUA layer fires.
5. Layer separation invariant — SEC rule ids only appear under
   `category: 'security'`; PII rule ids only under `'pii'`; QUA
   rule ids only under `'quality'`.
6. Grade band consistency — score → grade mapping matches the
   WasmClaw 0.5.0 bands (A≥90, B≥75, C≥50, D≥25, F<25).

---

## Running the manual protocols

Each `.manual.md` is a numbered checklist. Work through it in an
Extension Development Host window and record PASS / FAIL / N/A
next to each `§` component. When done, archive the filled-in
checklist alongside the release notes for the build under test.

---

## Why only `soulscan` is automated

Swarm Memory and most of SoulRollback are VS Code extension
surfaces (TreeDataProviders, FileSystemWatcher, git subprocess,
`vscode.window.show*Message`). Exercising them in a unit test
needs the Extension Host — which means shipping
`@vscode/test-electron` and designing an integration harness, a
much larger lift. A structured manual protocol is both cheaper to
produce and more useful when the artifact is "a human can verify
this in under 30 min".

`soulscan.ts` is pure TS with no `vscode` import — so it gets
the automated treatment as a fast regression gate.

---

## Keeping the suite honest

- If you rename or renumber a feature component, update the `§`
  headings in the manual protocol files to match.
- If you add a new SEC / PII / QUA rule category, add a fixture
  line that triggers it and a corresponding assertion in
  `soulscan.test.ts`.
- If a manual `§` protocol step starts depending on a specific
  command, add the command id to the step — e.g.,
  `clawsouls.checkpoint.autoRestore` — so the reviewer can run
  it from the command palette without guessing.
