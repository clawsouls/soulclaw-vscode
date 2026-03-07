import * as vscode from 'vscode';
import type { SoulClawEngine } from '../engine';

type ConnectionState = string;

export class StatusBarManager {
	private chatItem: vscode.StatusBarItem;
	private soulStatusItem: vscode.StatusBarItem;
	private agentStatusItem: vscode.StatusBarItem;
	private connectionStatusItem: vscode.StatusBarItem;
	private restartItem: vscode.StatusBarItem;
	private setupItem: vscode.StatusBarItem;
	
	constructor(
		private context: vscode.ExtensionContext,
		private engine: SoulClawEngine
	) {
		// Create status bar items
		this.chatItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
		this.soulStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.agentStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
		this.connectionStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
		this.restartItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
		this.setupItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
		
		this.setupStatusItems();
		this.updateStatusBar();
		
		// Listen for engine state changes
		this.engine.on('stateChange', (state: string) => {
			const mapped = state === 'ready' ? 'connected' : state === 'running' ? 'connected' : state;
			this.onConnectionStateChanged(mapped);
		});
		
		// Watch for soul.json changes to update status bar
		const soulWatcher = vscode.workspace.createFileSystemWatcher('**/soul.json');
		soulWatcher.onDidChange(() => this.refreshSoulName());
		soulWatcher.onDidCreate(() => this.refreshSoulName());
		soulWatcher.onDidDelete(() => { this.soulStatusItem.text = '🔮 No Soul'; });
		
		context.subscriptions.push(
			this.chatItem,
			this.soulStatusItem,
			this.agentStatusItem,
			this.connectionStatusItem,
			this.restartItem,
			this.setupItem,
			soulWatcher,
			vscode.commands.registerCommand('clawsouls.refreshStatusBar', () => this.refreshSoulName())
		);
	}
	
	private setupStatusItems(): void {
		// Chat button
		this.chatItem.text = '💬 Chat';
		this.chatItem.command = 'clawsouls.openChat';
		this.chatItem.tooltip = 'Open ClawSouls Chat';

		// Soul status
		this.soulStatusItem.command = 'clawsouls.openChat';
		this.soulStatusItem.tooltip = 'Click to open chat with current soul';
		
		// Agent status
		this.agentStatusItem.command = 'clawsouls.joinAgent';
		this.agentStatusItem.tooltip = 'Current agent/branch - click to switch';
		
		// Connection status
		this.connectionStatusItem.tooltip = 'OpenClaw Gateway connection status';
		
		// Restart button
		this.restartItem.text = '🔄';
		this.restartItem.command = 'clawsouls.restartGateway';
		this.restartItem.tooltip = 'Restart OpenClaw Gateway';

		// Setup button
		this.setupItem.text = '⚙️ Setup';
		this.setupItem.command = 'clawsouls.setup';
		this.setupItem.tooltip = 'Open ClawSouls Setup Wizard';
		
		// Show all items
		const config = vscode.workspace.getConfiguration('clawsouls');
		if (config.get('showStatusBar', true)) {
			this.chatItem.show();
			this.soulStatusItem.show();
			this.agentStatusItem.show();
			this.connectionStatusItem.show();
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
				this.connectionStatusItem.tooltip = 'Gateway idle - click to setup';
				break;
				
			case 'connecting':
				this.connectionStatusItem.text = '🔄 connecting';
				this.connectionStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
				this.connectionStatusItem.command = undefined;
				this.connectionStatusItem.tooltip = 'Connecting to Gateway...';
				break;
				
			case 'connected':
				this.connectionStatusItem.text = '🟢 connected';
				this.connectionStatusItem.backgroundColor = undefined;
				this.connectionStatusItem.command = 'clawsouls.openChat';
				this.connectionStatusItem.tooltip = 'Gateway connected - click to chat';
				break;
				
			case 'error':
				this.connectionStatusItem.text = '🔴 error — click to connect';
				this.connectionStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
				this.connectionStatusItem.command = 'clawsouls.connect';
				this.connectionStatusItem.tooltip = 'Gateway error - click to connect';
				break;
				
			case 'disconnected':
				this.connectionStatusItem.text = '⚪ disconnected — click to connect';
				this.connectionStatusItem.backgroundColor = undefined;
				this.connectionStatusItem.command = 'clawsouls.connect';
				this.connectionStatusItem.tooltip = 'Gateway disconnected - click to connect';
				break;
		}
	}
	
	private refreshSoulName(): void {
		const fs = require('fs');
		const path = require('path');

		// Check: OpenClaw workspace, VSCode workspace root, .clawsouls/ subdirs
		const roots: string[] = [];

		// OpenClaw workspace (where soul apply writes)
		const stateDir = process.env.OPENCLAW_STATE_DIR;
		const openclawWs = stateDir
			? path.join(stateDir, 'workspace')
			: (() => { const { getWorkspaceDir } = require('../paths'); return getWorkspaceDir(); })();
		roots.push(openclawWs);

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
	
	private getCurrentAgentName(): string {
		// For MVP, we'll just show a default agent name
		// Later this will integrate with swarm branch detection
		return 'agent/main';
	}
	
	public updateSoulName(name: string): void {
		this.soulStatusItem.text = `🔮 ${name}`;
	}
	
	public updateAgentName(name: string): void {
		this.agentStatusItem.text = `🐝 ${name}`;
	}
	
	public dispose(): void {
		this.soulStatusItem.dispose();
		this.agentStatusItem.dispose();
		this.connectionStatusItem.dispose();
		this.restartItem.dispose();
	}
}