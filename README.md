# ClawSouls Agent — Soul-Powered AI Development

Zero Setup AI Agent with Soul-based personas, Swarm Memory collaboration, and integrated development tools.

## Features

- 💬 **Chat Panel** — Talk to your AI agent directly in VSCode
- 📁 **Soul Explorer** — Browse soul.json, SOUL.md, AGENTS.md, MEMORY.md
- 🐝 **Swarm Memory** — Team AI knowledge collaboration
- 📊 **Checkpoints** — Version and rollback agent state
- 🔍 **SoulScan** — Security scanning for AI personas
- ⚙️ **Setup Wizard** — Guided configuration (LLM, API key, Gateway port)
- 🔌 **Contained Runtime** — OpenClaw runs inside VSCode, zero system pollution

## Requirements

- **Node.js 22+** (required for OpenClaw runtime)
- VSCode 1.85+

## Node.js Installation Guide

The extension auto-detects Node.js from nvm, fnm, volta, or system PATH. You only need Node 22+ installed — no need to set it as default.

### macOS / Linux

```bash
# Using nvm
nvm install 24
# That's it — extension finds it automatically
```

### Windows

```powershell
# Using nvm-windows
nvm install 24 64
nvm use 24.13.0
```

> ⚠️ **Windows**: If `nvm install 24` fails with "version not available", specify the architecture explicitly: `nvm install 24 64`

### Verify

```bash
node --version
# Should show v22.x.x or higher
```

## Quick Start

1. Install the extension from `.vsix` or VS Marketplace
2. Setup Wizard runs automatically on first launch
3. Choose your LLM provider (Anthropic / OpenAI / Ollama)
4. Enter API key (or Ollama URL + model)
5. Configure Gateway port (default: 18789)
6. Select or create a Soul
7. Start chatting!

## How It Works

The extension automatically:
1. Finds Node.js 22+ on your system (nvm, fnm, volta, PATH)
2. Installs OpenClaw into extension storage (`globalStorage/`)
3. Starts the OpenClaw Gateway as a background process
4. Connects via WebSocket for real-time chat

Everything is contained — uninstalling the extension cleans up completely.

## Status Bar

| Item | Description |
|------|-------------|
| 🔮 Soul Name | Current soul — click to chat |
| 🐝 agent/main | Current agent branch |
| 🟢 connected | Gateway status — click for action |
| 🔄 | Restart Gateway |
| ⚙️ Setup | Re-run setup wizard |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `clawsouls.gatewayUrl` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `clawsouls.autoConnect` | `true` | Auto-connect on startup |
| `clawsouls.llmProvider` | `anthropic` | LLM provider |
| `clawsouls.llmApiKey` | | API key for LLM |
| `clawsouls.ollamaUrl` | `http://127.0.0.1:11434` | Ollama API URL |
| `clawsouls.ollamaModel` | `llama3` | Ollama model name |
| `clawsouls.showStatusBar` | `true` | Show status bar items |

## Links

- [ClawSouls](https://clawsouls.ai) — AI persona platform
- [Soul Spec](https://clawsouls.ai/spec) — Open persona specification
- [Documentation](https://docs.clawsouls.ai) — Full docs
- [GitHub](https://github.com/clawsouls/clawsouls-vscode)

## License

MIT
