# Changelog

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
