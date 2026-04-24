# SoulClaw — Soul-Powered AI Agent

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/clawsouls.soulclaw-vscode?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=clawsouls.soulclaw-vscode)

Zero-setup AI agent with Soul-based personas, Swarm Memory collaboration, and integrated development tools — powered by [OpenClaw](https://github.com/openclaw/openclaw).

**[Install from VS Marketplace](https://marketplace.visualstudio.com/items?itemName=clawsouls.soulclaw-vscode)** | [Soul Registry](https://clawsouls.ai) | [CLI Version](https://soulclaw.sh) | [Docs](https://docs.clawsouls.ai)

> ⚠️ **Early Preview** — Under active development. Expect breaking changes.

## Features

### ✅ Implemented

- 💬 **Chat Panel** — Real-time AI chat in VSCode with streaming responses, message history, and session persistence
- 🎭 **Soul Explorer** — Browse 85+ community souls from [ClawSouls](https://clawsouls.ai), search/filter by category, preview details, one-click apply
- 🐝 **Swarm Memory** — Git-based team knowledge collaboration with branch management, push/pull, LLM-powered merge conflict resolution, age encryption
- 📊 **Checkpoints** — Create, scan, compare, and restore agent state snapshots with contamination detection
- 🔍 **SoulScan** — Run security scans on AI persona packages directly from the editor
- ⚙️ **Setup Wizard** — 5-step guided onboarding (LLM provider → API key → port → soul selection → done)
- 🎭 **Onboarding Soul Browser** — Dynamic soul picker during first-run setup, fetches live data from ClawSouls API with search, category filters, and popularity ranking
- ⚡ **Embedded Engine** — Direct LLM API calls, no separate process, no WebSocket, instant start
- 📉 **Tiered Bootstrap** — 40-60% token savings via progressive context loading
- 📋 **Chat History** — Browse and switch between past conversation sessions
- 📍 **Status Bar** — Live soul name, agent branch, connection status, quick actions
- 🔄 **Workspace Tracker** — Auto-syncs current project path to agent TOOLS.md for context awareness

### 🚧 Planned

- 🛒 VS Marketplace publishing
- 🔐 Private soul management
- 🤖 Multi-agent orchestration panel

## Requirements

- VSCode 1.85+
- **For cloud LLM**: Anthropic or OpenAI API key
- **For local LLM**: [Ollama](https://ollama.com) installed and running (`ollama serve`)

## Setup Guide

### (Optional) Set Up Ollama for Local LLM

```bash
# Install from https://ollama.com
ollama pull llama3.2
ollama serve
```

### Install & Configure

1. Install the extension from `.vsix` or VS Marketplace
2. Setup Wizard runs automatically on first launch:
   - **Step 1**: Choose LLM provider (Anthropic / OpenAI / Ollama)
   - **Step 2**: Enter API key or Ollama config
   - **Step 3**: Browse and pick a soul from the community
   - **Step 4**: Done! Chat opens automatically
3. Start building with your AI partner

## Panels

### 💬 Chat

Full-featured chat with streaming, markdown rendering, code blocks, and persistent history. Messages are saved across sessions — switch between past conversations via the history panel.

### 🎭 Soul Explorer

- **Browse mode**: Souls grouped by category, sorted by downloads, with SoulScan badges
- **Search**: Filter by name, description, or tags
- **Preview**: View full soul details, files, and scan results
- **Apply**: One-click apply to OpenClaw workspace with optional memory clear
- **Local mode**: Toggle to see soul files in your current workspace

### 📊 Checkpoints

- **Create**: Snapshot current agent state (SOUL.md, MEMORY.md, etc.)
- **Scan**: Run 4-layer contamination detection on any checkpoint
- **Compare**: Diff two checkpoints to see what changed
- **Restore**: Roll back to a previous state

### 🔍 SoulScan

- **Auto-scan on save**: Scans soul files automatically when you save
- **Sidebar panel**: View scan results grouped by category (Security, PII, Quality, Integrity)
- **4-layer detection**: 53 security rules (prompt injection in 8 languages, code execution, XSS, secrets, harmful content) + 2 PII rules (phone, email) + 11 structural quality rules + opt-in SHA-256 integrity verification
- **Inline diagnostics**: Warnings appear directly in your editor
- **Scoring**: 0-100 score with 5 risk levels (Verified → Blocked)
- **Run manually**: Click "Run SoulScan" in the sidebar panel

### 🐝 Swarm Memory

- **Init/Join**: Create or join a shared swarm repository
- **Push/Pull**: Sync memory changes with the team
- **Branch**: Create topic branches for isolated exploration
- **Merge**: LLM-powered semantic conflict resolution
- **Encryption**: Age-based encryption for sensitive memory with key rotation

## Status Bar

| Item | Description |
|------|-------------|
| 🔮 Soul Name | Current soul — click to chat |
| 🐝 agent/main | Current swarm branch |
| 🟢 connected | Engine status |
| 🔄 | Restart engine |
| ⚙️ | Re-run setup wizard |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `clawsouls.llmProvider` | `anthropic` | LLM provider (anthropic / openai / ollama) |
| `clawsouls.llmApiKey` | | API key for Anthropic or OpenAI |
| `clawsouls.llmModel` | | Model override (e.g. `claude-opus-4-6`) |
| `clawsouls.ollamaUrl` | `http://127.0.0.1:11434` | Ollama API URL |
| `clawsouls.ollamaModel` | `llama3` | Ollama model name |
| `clawsouls.autoConnect` | `true` | Auto-start engine on activation |
| `clawsouls.showStatusBar` | `true` | Show status bar items |

## How It Works

SoulClaw runs an **embedded AI engine** directly inside VSCode — no separate process, no WebSocket, no npm install.

1. Extension reads your LLM settings (API key, provider, model)
2. Loads soul files with **tiered bootstrap** (40-60% token savings)
3. Calls LLM APIs directly (Anthropic, OpenAI, or Ollama)
4. Streams responses in real-time to the chat panel

No ports, no connection failures, no zombie processes. Instant start.

## File Locations

All data stored in VSCode's `globalStorage` (cleaned up on uninstall):

| OS | Path |
|----|------|
| **Windows** | `%APPDATA%\Code\User\globalStorage\clawsouls.soulclaw-vscode\` |
| **macOS** | `~/Library/Application Support/Code/User/globalStorage/clawsouls.soulclaw-vscode/` |
| **Linux** | `~/.config/Code/User/globalStorage/clawsouls.soulclaw-vscode/` |

## Disclaimer

This extension is provided "as is" without warranty of any kind. It is an independent project by [ClawSouls](https://clawsouls.ai) and is **not officially affiliated with or endorsed by the OpenClaw project**. Use at your own risk.

## Roadmap

- **v0.7** — Streaming responses, conversation compaction, model selection UI
- **v0.8** — Shared engine core (`@clawsouls/engine-core`), plugin SDK
- **v0.9** — VS Marketplace publish, multi-agent orchestration
- **v1.0** — Full SoulClaw CLI parity, embedded source engine

## License

**Apache License 2.0** (extension) + **MIT** (embedded OpenClaw runtime).

See [LICENSE](LICENSE) for details.

## Links

- [ClawSouls](https://clawsouls.ai) — AI persona platform
- [Soul Spec](https://clawsouls.ai/spec) — Open persona specification
- [Documentation](https://docs.clawsouls.ai) — Full docs
- [Blog](https://blog.clawsouls.ai) — Guides & updates
- [GitHub](https://github.com/clawsouls/clawsouls-vscode) — Source code & issues
