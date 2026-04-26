# Changelog

## [0.8.3] - 2026-04-27

### Added
- **`ClawSouls: Checkpoint — Auto-Restore` exposed in Command Palette + Soul Checkpoints panel toolbar** — the auto-restore handler shipped in 0.8.2 (`registerCommand('clawsouls.checkpoint.autoRestore', …)`) was reachable only programmatically. Now declared in `package.json#contributes.commands` and bound to the `clawsouls.checkpoints` view's title bar via `view/title navigation@2` with the `$(history)` icon, so users can trigger the multi-layer scan + first-contamination identification + restore-from-immediately-preceding-clean-checkpoint flow directly from the UI.

## [0.8.2] - 2026-04-26

### Added
- **SoulScan: 4th INTEGRITY detection layer** — opt-in SHA-256 hash verification via `ScanOptions.expectedHashes`. When a caller (e.g. `checkpointPanel`) passes the hashes map from a `checkpoint.json` manifest, each soul file is hashed and compared; mismatches emit `INT001` with `severity: error`. The pre-existing 3 layers (SECURITY, PII, QUALITY) always run; INTEGRITY is opt-in and a no-op when no map is provided. `ScanResult.categories` now exposes all 4 keys (`security`, `quality`, `pii`, `integrity`) so the sidebar UI can render a consistent 4-layer badge.
- **SoulRollback: auto-restore command** — `clawsouls.checkpoint.autoRestore` walks history newest-first, identifies the first contamination point (score < `CLEAN_THRESHOLD = 75`), takes a pre-restore safety snapshot via `createCheckpointSilent()`, verifies SHA-256 hashes against the checkpoint manifest, and overwrites the workspace with the immediately-preceding clean checkpoint.
- **SoulRollback: retention policy** — `MAX_CHECKPOINT_HISTORY = 50` enforced after every `createCheckpoint` and `createCheckpointSilent` call. Oldest entries dropped on disk to keep `.clawsouls/checkpoints/` from unbounded growth on heartbeat-driven workspaces.
- **Regression test suite** — `tests/`:
  - `tests/soulscan.test.ts` (10/10 passing, run via `npx tsx`) covers the 4-layer separation invariant (rule-id prefix ↔ category 1:1) and grade-band consistency with WasmClaw 0.5.0.
  - Manual walkthrough protocols (en + ko) covering each Swarm Memory and SoulRollback feature end-to-end, including regression checks for the v0.8.1 swarm hardening batch.

### Changed
- **SoulScan grade bands aligned with WasmClaw 0.5.0** — `A ≥ 90`, `B ≥ 75`, `C ≥ 50`, `D ≥ 25`, `F < 25` (previously `60`/`40`). Same persona now lands in the same band whether scanned via the extension or via the standalone WasmClaw engine.
- **SoulScan layers explicitly separated** — `SECURITY_RULES` / `PII_RULES` / `QUALITY` / `INTEGRITY` are now four named, independently-iterated rule batteries inside `src/engine/soulscan.ts`. PII rules previously lived inside `SECURITY_RULES` and emitted `category: 'security'`; they now use `category: 'pii'`. No behaviour change for the clean-checkpoint walk (still score-based), but the layer breakdown is observable via `result.categories`.
- **README SoulScan section reconciled** — `58 security rules` → `53 security rules` (actual count after PII extraction); category list `(Security, PII, Quality)` → `(Security, PII, Quality, Integrity)`; the layer breakdown is now itemised so the Marketplace-public statement is backed by precise numbers.

### Fixed
- **Swarm: shell injection in LLM conflict resolver** — the curl invocation in `llmResolveConflicts` previously interpolated the prompt into argv. Switched to `--data-binary @-` with stdin via `execSync` input, eliminating any path where prompt content could be parsed by the shell.
- **Swarm: agent-branch fallback prevented** — `pushWithSync` now throws when the explicit per-agent branch can't be pushed instead of silently falling back to `main` (or, worse, another agent's branch).
- **Swarm: deletion sync** — `syncWorkspaceToSwarm` now mirrors deletions; previously a file removed locally would re-appear from the swarm pull.
- **Swarm: watcher scope** — `FileSystemWatcher` ignores `.git/`, `.soulscan/` (except `swarm.json`), and `.age` files so editor housekeeping no longer triggers spurious sync.
- **Swarm: staging scope on `joinAgent`** — only `.soulscan/swarm.json` is staged on join, never the whole workspace tree.
- **Swarm: error classification on `git checkout -b`** — only fall through on the literal "already exists" message; other failures throw with the exact stderr.
- **Swarm: explicit LLM-resolved count** — total resolved files is read from a counter incremented at resolution time, not inferred from a last-write guess.
- **Rollback: surfaced restart failures** — when `clawsouls.restartGateway` throws after a checkpoint restore, a warning toast tells the user the soul files are restored but the engine still holds the contaminated state in memory. Previously this failure was silently swallowed.
- **Setup: `fetchSouls` debug logging** — the soul-picker showing "no results" is no longer indistinguishable from "fetchSouls threw"; the Extension Host output channel now logs the count on success and the error detail on failure.

## [0.5.1] - 2026-03-07

### Added
- **Tool Calling**: Agent can read/write/edit files, run commands, search (agentic loop, max 10 rounds)
- **Code Actions**: Right-click → Ask SoulClaw / Explain / Fix / Add to Context
- **CodeLens**: Inline Ask/Explain/Fix buttons above functions and classes (7 languages)
- **Context Buffer**: Accumulate code snippets from multiple files, send together
- **Telegram Setup**: Optional Step 4 in setup wizard with connection test
- **Copy Button**: Hover over code blocks to copy
- **Stop Button**: Abort running generation
- **Tool Execution Log**: Real-time display of tool calls and results
- **Dangerous Command Guard**: Confirmation popup for rm, sudo, git push, etc.
- **API Key Validation**: Test API key during setup
- **API Key SecretStorage**: Migrated from plaintext Settings to VSCode SecretStorage
- **Auto-open Files**: Files created/edited by agent open automatically
- **Config Auto-restart**: Engine restarts when settings change
- **Error Retry**: Automatic retry on network errors (1 attempt, 2s delay)
- **OpenAI Tool Calling**: Function call parsing for OpenAI provider

### Fixed
- Soul selection in setup no longer breaks chat (listener preservation)
- CodeLens now auto-selects function body before action

## [0.4.1] - 2026-03-07

### Added
- Path centralization via `src/paths.ts`
- All panels use `getWorkspaceDir()` / `getSwarmDir()`

## [0.4.0] - 2026-03-07

### Added
- Embedded SoulClaw runtime (no gateway process needed)
- Direct LLM API calls (Anthropic, OpenAI, Ollama)
- Tiered Bootstrap Loading (40-60% token savings)
- Session persistence (JSON-based)

### Changed
- Runtime switched from OpenClaw to SoulClaw (`soulclaw@2026.3.6`)
- Package renamed from `clawsouls-agent` to `soulclaw-vscode`

## [0.3.0] - 2026-03-07

### Changed
- Rebranded from "ClawSouls Agent" to "SoulClaw"

## [0.2.0] - 2026-03-07

### Added
- Soul browser in onboarding (API search, categories, popularity)
- One-click soul apply from ClawSouls platform
- Chat history panel
- Workspace tracker

## [0.1.0] - 2026-03-05

### Added
- Initial release
- Setup wizard (3 steps)
- Chat panel with streaming
- Soul Explorer (local + remote browse)
- Checkpoint panel (create/restore/delete/diff)
- Swarm Memory panel (init/join/push/pull/merge/encrypt)
- Status bar (soul name, agent branch, connection status)
- SoulScan via terminal
