import * as vscode from 'vscode';
import type { SoulClawEngine } from '../engine';

type ConnectionState = string;

export class StatusBarManager {
	private chatItem: vscode.StatusBarItem;
	private modelItem: vscode.StatusBarItem;
	private soulStatusItem: vscode.StatusBarItem;
	private agentStatusItem: vscode.StatusBarItem;
	private connectionStatusItem: vscode.StatusBarItem;
	private telegramItem: vscode.StatusBarItem;
	private restartItem: vscode.StatusBarItem;
	private setupItem: vscode.StatusBarItem;
	
	constructor(
		private context: vscode.ExtensionContext,
		private engine: SoulClawEngine
	) {
		// Create status bar items
		this.chatItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
		this.modelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100.5);
		this.soulStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.agentStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
		this.connectionStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
		this.telegramItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
		this.restartItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
		this.setupItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
		
		this.setupStatusItems();
		this.updateStatusBar();
		
		// Listen for engine state changes
		this.engine.on('stateChange', (state: string) => {
			const mapped = state === 'ready' ? 'connected' : state === 'running' ? 'connected' : state;
			this.onConnectionStateChanged(mapped);
		});

		// Token count updates
		this.engine.on('tokenUpdate', (count: number) => {
			const k = (count / 1000).toFixed(1);
			this.connectionStatusItem.tooltip = `Connected · ~${k}K tokens used this session`;
		});
		
		// Watch for soul.json changes to update status bar
		const soulWatcher = vscode.workspace.createFileSystemWatcher('**/soul.json');
		soulWatcher.onDidChange(() => this.refreshSoulName());
		soulWatcher.onDidCreate(() => this.refreshSoulName());
		soulWatcher.onDidDelete(() => { this.soulStatusItem.text = '🔮 No Soul'; });
		
		context.subscriptions.push(
			this.chatItem,
			this.modelItem,
			this.soulStatusItem,
			this.agentStatusItem,
			this.connectionStatusItem,
			this.telegramItem,
			this.restartItem,
			this.setupItem,
			soulWatcher,
			vscode.commands.registerCommand('clawsouls.refreshStatusBar', () => { this.refreshSoulName(); this.refreshAgentName(); }),
			vscode.commands.registerCommand('clawsouls.selectModel', () => this.selectModel())
		);
	}
	
	private setupStatusItems(): void {
		// Chat button
		this.chatItem.text = '💬 Chat';
		this.chatItem.command = 'clawsouls.openChat';
		this.chatItem.tooltip = 'Open ClawSouls Chat';

		// Model selector
		this.modelItem.command = 'clawsouls.selectModel';
		this.modelItem.tooltip = 'Click to change LLM model';
		this.updateModelStatus();

		// Soul status — click to show Soul Explorer
		this.soulStatusItem.command = 'clawsouls.soulExplorer.focus';
		this.soulStatusItem.tooltip = 'Click to browse & switch souls';
		
		// Agent status
		this.agentStatusItem.command = 'clawsouls.swarm.focus';
		this.agentStatusItem.tooltip = 'Current agent/branch - click to open Swarm Memory';
		
		// Connection status
		this.connectionStatusItem.tooltip = 'SoulClaw Engine connection status';
		
		// Telegram status
		this.updateTelegramStatus();

		// Restart button
		this.restartItem.text = '🔄';
		this.restartItem.command = 'clawsouls.restartGateway';
		this.restartItem.tooltip = 'Restart SoulClaw Engine';

		// Setup button
		this.setupItem.text = '⚙️ Setup';
		this.setupItem.command = 'clawsouls.setup';
		this.setupItem.tooltip = 'Open ClawSouls Setup Wizard';
		
		// Show all items
		const config = vscode.workspace.getConfiguration('clawsouls');
		if (config.get('showStatusBar', true)) {
			this.chatItem.show();
			this.modelItem.show();
			this.soulStatusItem.show();
			this.agentStatusItem.show();
			this.connectionStatusItem.show();
			this.telegramItem.show();
			this.restartItem.show();
			this.setupItem.show();
		}
	}
	
	private updateStatusBar(): void {
		// Update soul status (async — will update text when ready)
		this.soulStatusItem.text = '🔮 Loading...';
		this.refreshSoulName();
		
		// Update agent status
		const currentAgent = this.getCurrentAgentName();
		this.agentStatusItem.text = `🐝 ${currentAgent}`;
		
		// Connection status is updated by onConnectionStateChanged
	}
	
	private onConnectionStateChanged(state: ConnectionState): void {
		this.updateConnectionStatus(state);
	}
	
	private updateConnectionStatus(state: ConnectionState): void {
		switch (state) {
			case 'idle':
				this.connectionStatusItem.text = '⚪ idle';
				this.connectionStatusItem.backgroundColor = undefined;
				this.connectionStatusItem.command = 'clawsouls.setup';
				this.connectionStatusItem.tooltip = 'Engine idle - click to setup';
				break;
				
			case 'connecting':
				this.connectionStatusItem.text = '🔄 connecting';
				this.connectionStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
				this.connectionStatusItem.command = undefined;
				this.connectionStatusItem.tooltip = 'Connecting......';
				break;
				
			case 'connected':
				this.connectionStatusItem.text = '🟢 connected';
				this.connectionStatusItem.backgroundColor = undefined;
				this.connectionStatusItem.command = 'clawsouls.openChat';
				this.connectionStatusItem.tooltip = 'Connected - click to chat';
				break;
				
			case 'error':
				this.connectionStatusItem.text = '🔴 error — click to connect';
				this.connectionStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
				this.connectionStatusItem.command = 'clawsouls.connect';
				this.connectionStatusItem.tooltip = 'Engine error - click to connect';
				break;
				
			case 'disconnected':
				this.connectionStatusItem.text = '⚪ disconnected — click to connect';
				this.connectionStatusItem.backgroundColor = undefined;
				this.connectionStatusItem.command = 'clawsouls.connect';
				this.connectionStatusItem.tooltip = 'Disconnected - click to connect';
				break;
		}
	}
	
	private refreshSoulName(): void {
		const fs = require('fs');
		const path = require('path');

		// Check: SoulClaw workspace, VSCode workspace root, .clawsouls/ subdirs
		const roots: string[] = [];

		// SoulClaw workspace (where soul apply writes)
		const stateDir = process.env.OPENCLAW_STATE_DIR;
		const workspaceRoot = stateDir
			? path.join(stateDir, 'workspace')
			: (() => { const { getWorkspaceDir } = require('../paths'); return getWorkspaceDir(); })();
		roots.push(workspaceRoot);

		// VSCode workspace
		const workspaces = vscode.workspace.workspaceFolders;
		if (workspaces && workspaces.length > 0) {
			roots.push(workspaces[0].uri.fsPath);
			const clawsoulsDir = path.join(workspaces[0].uri.fsPath, '.clawsouls');
			if (fs.existsSync(clawsoulsDir)) {
				try {
					const entries = fs.readdirSync(clawsoulsDir, { withFileTypes: true });
					for (const e of entries) {
						if (e.isDirectory()) roots.push(path.join(clawsoulsDir, e.name));
					}
				} catch {}
			}
		}

		for (const root of roots) {
			const soulJsonPath = path.join(root, 'soul.json');
			try {
				if (fs.existsSync(soulJsonPath)) {
					const data = fs.readFileSync(soulJsonPath, 'utf8');
					const soulConfig = JSON.parse(data);
					const name = soulConfig.displayName || soulConfig.name || 'Unknown';
					this.soulStatusItem.text = `🔮 ${name}`;
					return;
				}
			} catch {}
		}
		this.soulStatusItem.text = '🔮 No Soul';
	}
	
	private refreshAgentName(): void {
		const name = this.getCurrentAgentName();
		this.agentStatusItem.text = `🐝 ${name}`;
	}

	private getCurrentAgentName(): string {
		try {
			const { getSwarmDir } = require('../paths');
			const swarmDir = getSwarmDir();
			const fs = require('fs');
			if (fs.existsSync(require('path').join(swarmDir, '.git'))) {
				const { execSync } = require('child_process');
				const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: swarmDir, encoding: 'utf8' }).trim();
				return branch || 'agent/main';
			}
		} catch {}
		return 'agent/main';
	}
	
	public updateTelegramStatus(): void {
		// Check if relay is actually active (set by extension.ts on successful start)
		const connected = !!(globalThis as any).__soulclawTelegram;

		if (connected) {
			this.telegramItem.text = '🟢 Telegram';
			this.telegramItem.tooltip = 'Telegram connected — click to reconfigure';
			this.telegramItem.command = 'clawsouls.setupTelegram';
			this.telegramItem.backgroundColor = undefined;
		} else {
			this.telegramItem.text = '🔴 Telegram';
			this.telegramItem.tooltip = 'Telegram not connected — click to set up';
			this.telegramItem.command = 'clawsouls.setupTelegram';
			this.telegramItem.backgroundColor = undefined;
		}
	}

	private getCurrentModelDisplay(): string {
		const config = vscode.workspace.getConfiguration('clawsouls');
		const provider = config.get<string>('llmProvider', 'anthropic');
		const model = config.get<string>('llmModel', '');
		if (model) {
			return model;
		}
		// Provider defaults
		switch (provider) {
			case 'anthropic': return 'claude-sonnet-4-20250514';
			case 'openai': return 'gpt-4o';
			case 'ollama': return config.get<string>('ollamaModel', 'llama3');
			default: return 'unknown';
		}
	}

	public updateModelStatus(): void {
		const model = this.getCurrentModelDisplay();
		// Shorten for display
		const short = model
			.replace('claude-sonnet-4-20250514', 'claude-sonnet-4')
			.replace('claude-opus-4-6', 'claude-opus-4')
			.replace('claude-haiku-3', 'claude-haiku-3')
			.replace('gpt-4o-mini', 'gpt-4o-mini');
		this.modelItem.text = `$(symbol-misc) ${short}`;
	}

	public async selectModel(): Promise<void> {
		const config = vscode.workspace.getConfiguration('clawsouls');
		const provider = config.get<string>('llmProvider', 'anthropic');
		const currentModel = this.getCurrentModelDisplay();

		const modelsByProvider: Record<string, { label: string; description?: string }[]> = {
			anthropic: [
				{ label: 'claude-sonnet-4-20250514', description: 'Balanced speed & quality' },
				{ label: 'claude-opus-4-6', description: 'Most capable' },
				{ label: 'claude-haiku-3', description: 'Fastest' },
			],
			openai: [
				{ label: 'gpt-4o', description: 'Most capable' },
				{ label: 'gpt-4o-mini', description: 'Fast & affordable' },
				{ label: 'o1', description: 'Reasoning model' },
			],
			ollama: [
				{ label: config.get<string>('ollamaModel', 'llama3'), description: 'Current Ollama model' },
			],
		};

		const models = modelsByProvider[provider] || [];
		// Mark current
		const items = models.map(m => ({
			label: m.label === currentModel ? `$(check) ${m.label}` : m.label,
			description: m.description,
			modelId: m.label,
		}));

		// Add option to switch provider
		items.push({ label: '', description: '', modelId: '' }); // separator hack
		items.push({ label: '$(gear) Change Provider...', description: `Current: ${provider}`, modelId: '__switch_provider__' });

		const pick = await vscode.window.showQuickPick(items, {
			placeHolder: `Select model (provider: ${provider})`,
		});

		if (!pick || !pick.modelId) { return; }

		if (pick.modelId === '__switch_provider__') {
			const providerPick = await vscode.window.showQuickPick(
				['anthropic', 'openai', 'ollama'].map(p => ({
					label: p === provider ? `$(check) ${p}` : p,
					providerId: p,
				})),
				{ placeHolder: 'Select LLM provider' }
			);
			if (providerPick) {
				await config.update('llmProvider', providerPick.providerId, vscode.ConfigurationTarget.Global);
				await config.update('llmModel', '', vscode.ConfigurationTarget.Global);
				this.updateModelStatus();
				vscode.commands.executeCommand('clawsouls.restartGateway');
			}
			return;
		}

		await config.update('llmModel', pick.modelId, vscode.ConfigurationTarget.Global);
		this.updateModelStatus();
		vscode.commands.executeCommand('clawsouls.restartGateway');
	}

	public updateSoulName(name: string): void {
		this.soulStatusItem.text = `🔮 ${name}`;
	}
	
	public updateAgentName(name: string): void {
		this.agentStatusItem.text = `🐝 ${name}`;
	}
	
	public dispose(): void {
		this.modelItem.dispose();
		this.soulStatusItem.dispose();
		this.agentStatusItem.dispose();
		this.connectionStatusItem.dispose();
		this.telegramItem.dispose();
		this.restartItem.dispose();
	}
}