# ClawSouls Agent — Soul-Powered AI Development

Zero-setup AI agent with Soul-based personas, Swarm Memory collaboration, and integrated development tools — powered by [OpenClaw](https://github.com/openclaw/openclaw).

> ⚠️ **Early Preview** — This extension is under active development. Some features (Soul Explorer, Swarm Memory GUI, Checkpoint GUI) are not yet fully implemented. Expect breaking changes.

## Features

- 💬 **Chat Panel** — Talk to your AI agent directly in VSCode
- 📁 **Soul Explorer** — Browse soul.json, SOUL.md, AGENTS.md, MEMORY.md *(coming soon)*
- 🐝 **Swarm Memory** — Team AI knowledge collaboration *(coming soon)*
- 📊 **Checkpoints** — Version and rollback agent state *(coming soon)*
- 🔍 **SoulScan** — Security scanning for AI personas *(coming soon)*
- ⚙️ **Setup Wizard** — Guided configuration (LLM, API key, Gateway port)
- 🔌 **Contained Runtime** — OpenClaw runs inside VSCode, zero system pollution

## Requirements

- **Node.js 22+** (required for OpenClaw runtime)
- VSCode 1.85+
- **For local LLM**: [Ollama](https://ollama.com) installed and running (`ollama serve`)

## Setup Guide

### Step 1: Install Node.js 22+

The extension auto-detects Node.js from nvm, fnm, volta, or system PATH. You only need Node 22+ installed — no need to set it as default.

#### macOS / Linux

```bash
# Using nvm (recommended)
nvm install 24
# That's it — extension finds it automatically
```

#### Windows

```powershell
# Using nvm-windows (https://github.com/coreybutler/nvm-windows)
nvm install 24.13.0 64
nvm use 24.13.0
```

> ⚠️ **Windows**: You must specify the architecture: `nvm install 24 64`. Without `64`, nvm-windows may fail with "version not available."

#### Direct Install (no version manager)

Download Node.js 24+ from [nodejs.org](https://nodejs.org/) and install.

#### Verify

```bash
node --version
# Should show v22.x.x or higher
```

### Step 2: (Optional) Set Up Ollama for Local LLM

If you want to use a **local LLM instead of a cloud API**, install and start Ollama:

```bash
# Install from https://ollama.com

# Pull a model
ollama pull llama3.2

# Start the server (keep this running)
ollama serve
```

> 💡 **Windows users**: Ollama is the recommended setup. No API key needed, fully offline, and works with GPU acceleration (NVIDIA CUDA supported).

### Step 3: Install & Configure the Extension

1. Install the extension from `.vsix` or VS Marketplace
2. Setup Wizard runs automatically on first launch
3. Choose your LLM provider:
   - **Anthropic** — Enter API key (`sk-ant-...`)
   - **OpenAI** — Enter API key (`sk-...`)
   - **Ollama** — Enter Ollama URL (`http://127.0.0.1:11434`) and model name (e.g. `llama3.2`)
4. Configure Gateway port (default: 18789)
5. Start chatting!

## How It Works

The extension automatically:
1. Finds Node.js 22+ on your system (nvm, fnm, volta, PATH)
2. Installs OpenClaw into extension storage (`globalStorage/`)
3. Starts the OpenClaw Gateway as a background process
4. Connects via WebSocket for real-time chat

Everything is contained — uninstalling the extension cleans up completely. No global npm packages, no PATH modifications, no leftover files.

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
| `clawsouls.llmProvider` | `anthropic` | LLM provider (anthropic / openai / ollama) |
| `clawsouls.llmApiKey` | | API key for Anthropic or OpenAI |
| `clawsouls.llmModel` | | Model override (e.g. `claude-opus-4-6`) |
| `clawsouls.ollamaUrl` | `http://127.0.0.1:11434` | Ollama API URL |
| `clawsouls.ollamaModel` | `llama3` | Ollama model name |
| `clawsouls.gatewayUrl` | `ws://127.0.0.1:18789` | Gateway WebSocket URL |
| `clawsouls.gatewayPort` | `18789` | Gateway port |
| `clawsouls.autoConnect` | `true` | Auto-connect on startup |
| `clawsouls.showStatusBar` | `true` | Show status bar items |

## File Locations

This extension writes files to the following locations:

| OS | Extension Storage | OpenClaw Config |
|----|-------------------|-----------------|
| **Windows** | `C:\Users\{username}\AppData\Roaming\Code\User\globalStorage\clawsouls.clawsouls-agent\` | `C:\Users\{username}\.openclaw\` |
| **macOS** | `~/Library/Application Support/Code/User/globalStorage/clawsouls.clawsouls-agent/` | `~/.openclaw/` |
| **Linux** | `~/.config/Code/User/globalStorage/clawsouls.clawsouls-agent/` | `~/.openclaw/` |

> ⚠️ **Note**: The extension may overwrite files in these directories. The `globalStorage` directory is managed by VSCode and cleaned up on uninstall. The `.openclaw` directory contains authentication tokens and agent configuration — it persists after uninstall.

## Disclaimer

This extension is provided "as is" without warranty of any kind. It is an independent project by [ClawSouls](https://clawsouls.ai) and is **not officially affiliated with or endorsed by the OpenClaw project**. Use at your own risk. The authors are not responsible for any data loss, API charges, or other damages arising from the use of this software.

## License

This extension is licensed under the **Apache License 2.0**.

This extension embeds [OpenClaw](https://github.com/openclaw/openclaw), which is licensed under the **MIT License**. OpenClaw is an independent open-source project — its inclusion does not imply endorsement.

See [LICENSE](LICENSE) for details.

## Links

- [ClawSouls](https://clawsouls.ai) — AI persona platform
- [Soul Spec](https://clawsouls.ai/spec) — Open persona specification
- [Documentation](https://docs.clawsouls.ai) — Full docs
- [GitHub](https://github.com/clawsouls/clawsouls-vscode) — Source code & issues
