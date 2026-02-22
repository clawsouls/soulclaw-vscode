# Soul Spec — AI Persona Manager

Browse, install, and manage AI persona packages ([Soul Spec](https://clawsouls.ai)) directly from VS Code.

Soul Spec is an open spec for defining portable AI personas that work across Claude Code, Cursor, Windsurf, OpenClaw, and more.

## Features

### 🔍 Soul Browser
Browse 80+ community souls from the sidebar. Search by name, category, or tags.

### 📦 Install Soul
**Command:** `Soul Spec: Install Soul`

Pick a soul from the registry and install it into your workspace — downloads `soul.json`, `SOUL.md`, `IDENTITY.md`, and all related files.

### 🆕 Initialize Soul
**Command:** `Soul Spec: Init`

Scaffold a new soul with interactive prompts for name, description, and personality traits.

### 🔄 Platform Export
**Command:** `Soul Spec: Export for...`

Export your soul for any platform:
- **Claude Code** → `CLAUDE.md`
- **Cursor** → `.cursor/rules/soul.md`
- **Windsurf** → `.windsurfrules`
- **OpenClaw** → as-is

### ✅ Validation
Real-time linting of `soul.json` against Soul Spec v0.4 schema with errors and warnings in the Problems panel.

### 🛡️ Status Bar
Shows Soul Spec status when a `soul.json` is detected. Click to view details on clawsouls.ai.

## Quick Start

1. Install the extension
2. Open the **Soul Spec** sidebar (activity bar icon)
3. Browse or search for a soul
4. Click to install, or run `Soul Spec: Init` to create your own

## Links

- [ClawSouls Registry](https://clawsouls.ai)
- [Blog](https://blog.clawsouls.ai)
- [Soul Spec Documentation](https://clawsouls.ai/docs/soul-spec)

## License

Apache-2.0
