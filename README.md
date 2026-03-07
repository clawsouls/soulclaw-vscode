# ClawSouls Agent — Soul-Powered AI Development

Zero-setup AI agent with Soul-based personas, Swarm Memory collaboration, and integrated development tools — powered by [OpenClaw](https://github.com/openclaw/openclaw).

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
- 🔌 **Contained Runtime** — OpenClaw installs into extension storage, zero system pollution, clean uninstall
- 📋 **Chat History** — Browse and switch between past conversation sessions
- 📍 **Status Bar** — Live soul name, agent branch, connection status, quick actions
- 🔄 **Workspace Tracker** — Auto-syncs current project path to agent TOOLS.md for context awareness

### 🚧 Planned

- 🛒 VS Marketplace publishing
- 🔐 Private soul management
- 🤖 Multi-agent orchestration panel

## Requirements

- **Node.js 22+** (required for OpenClaw runtime)
- VSCode 1.85+
- **For local LLM**: [Ollama](https://ollama.com) installed and running (`ollama serve`)

## Setup Guide

### Step 1: Install Node.js 22+

The extension auto-detects Node.js from nvm, fnm, volta, or system PATH.

#### macOS / Linux

```bash
# Using nvm (recommended)
nvm install 24
```

#### Windows

```powershell
# Using nvm-windows
nvm install 24.13.0 64
nvm use 24.13.0
```

> ⚠️ **Windows**: Specify architecture: `nvm install 24 64`. Without `64`, nvm-windows may fail.

#### Direct Install

Download Node.js 24+ from [nodejs.org](https://nodejs.org/).

### Step 2: (Optional) Set Up Ollama for Local LLM

```bash
# Install from https://ollama.com
ollama pull llama3.2
ollama serve
```

### Step 3: Install & Configure

1. Install the extension from `.vsix` or VS Marketplace
2. Setup Wizard runs automatically on first launch:
   - **Step 1**: Choose LLM provider (Anthropic / OpenAI / Ollama)
   - **Step 2**: Enter API key or Ollama config
   - **Step 3**: Configure Gateway port (default: 18789)
   - **Step 4**: Browse and pick a soul from the community — search, filter by category, see download counts and scan scores
   - **Step 5**: Done! Chat opens automatically
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
| 🟢 connected | Gateway status — click for action |
| 🔄 | Restart Gateway |
| ⚙️ | Re-run setup wizard |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `clawsouls.llmProvider` | `anthropic` | LLM provider (anthropic / openai / ollama) |
| `clawsouls.llmApiKey` | | API key for Anthropic or OpenAI |
| `clawsouls.llmModel` | | Model override (e.g. `claude-opus-4-6`) |
| `clawsouls.ollamaUrl` | `http://127.0.0.1:11434` | Ollama API URL |
| `clawsouls.ollamaModel` | `llama3` | Ollama model name |
| `clawsouls.gatewayUrl` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `clawsouls.gatewayPort` | `18789` | Gateway port |
| `clawsouls.autoConnect` | `true` | Auto-connect on startup |
| `clawsouls.showStatusBar` | `true` | Show status bar items |

## How It Works

1. Extension finds Node.js 22+ on your system (nvm, fnm, volta, PATH)
2. Installs OpenClaw into extension storage (`globalStorage/`)
3. Starts the OpenClaw Gateway as a background process
4. Connects via WebSocket for real-time chat

Everything is contained — uninstalling cleans up completely.

## File Locations

| OS | Extension Storage | OpenClaw Config |
|----|-------------------|-----------------|
| **Windows** | `%APPDATA%\Code\User\globalStorage\clawsouls.clawsouls-agent\` | `%USERPROFILE%\.openclaw\` |
| **macOS** | `~/Library/Application Support/Code/User/globalStorage/clawsouls.clawsouls-agent/` | `~/.openclaw/` |
| **Linux** | `~/.config/Code/User/globalStorage/clawsouls.clawsouls-agent/` | `~/.openclaw/` |

## Disclaimer

This extension is provided "as is" without warranty of any kind. It is an independent project by [ClawSouls](https://clawsouls.ai) and is **not officially affiliated with or endorsed by the OpenClaw project**. Use at your own risk.

## License

**Apache License 2.0** (extension) + **MIT** (embedded OpenClaw runtime).

See [LICENSE](LICENSE) for details.

## Links

- [ClawSouls](https://clawsouls.ai) — AI persona platform
- [Soul Spec](https://clawsouls.ai/spec) — Open persona specification
- [Documentation](https://docs.clawsouls.ai) — Full docs
- [Blog](https://blog.clawsouls.ai) — Guides & updates
- [GitHub](https://github.com/clawsouls/clawsouls-vscode) — Source code & issues
