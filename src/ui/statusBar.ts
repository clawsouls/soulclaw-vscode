import * as vscode from 'vscode';
import { GatewayConnection, ConnectionState } from '../gateway/connection';

export class StatusBarManager {
	private chatItem: vscode.StatusBarItem;
	private soulStatusItem: vscode.StatusBarItem;
	private agentStatusItem: vscode.StatusBarItem;
	private connectionStatusItem: vscode.StatusBarItem;
	private restartItem: vscode.StatusBarItem;
	private setupItem: vscode.StatusBarItem;
	
	constructor(
		private context: vscode.ExtensionContext,
		private gateway: GatewayConnection
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
		
		// Listen for connection state changes
		this.gateway.onStateChanged(this.onConnectionStateChanged.bind(this));
		
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
			soulWatcher
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
		// Update soul status
		const currentSoul = this.getCurrentSoulName();
		this.soulStatusItem.text = `🔮 ${currentSoul}`;
		
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
	
	private getCurrentSoulName(): string {
		this.refreshSoulName();
		return 'No Soul';
	}
	
	private async refreshSoulName(): Promise<void> {
		const workspaces = vscode.workspace.workspaceFolders;
		if (!workspaces || workspaces.length === 0) return;
		
		try {
			const fs = await import('fs');
			const path = await import('path');
			const soulJsonPath = path.join(workspaces[0].uri.fsPath, 'soul.json');
			
			if (fs.existsSync(soulJsonPath)) {
				const data = fs.readFileSync(soulJsonPath, 'utf8');
				const soulConfig = JSON.parse(data);
				const name = soulConfig.displayName || soulConfig.name || 'Unknown';
				this.soulStatusItem.text = `🔮 ${name}`;
			} else {
				this.soulStatusItem.text = '🔮 No Soul';
			}
		} catch {
			this.soulStatusItem.text = '🔮 No Soul';
		}
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