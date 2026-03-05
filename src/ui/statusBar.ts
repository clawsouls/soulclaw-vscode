import * as vscode from 'vscode';
import { GatewayConnection, ConnectionState } from '../gateway/connection';

export class StatusBarManager {
	private soulStatusItem: vscode.StatusBarItem;
	private agentStatusItem: vscode.StatusBarItem;
	private connectionStatusItem: vscode.StatusBarItem;
	private restartItem: vscode.StatusBarItem;
	
	constructor(
		private context: vscode.ExtensionContext,
		private gateway: GatewayConnection
	) {
		// Create status bar items
		this.soulStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this.agentStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
		this.connectionStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
		this.restartItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
		
		this.setupStatusItems();
		this.updateStatusBar();
		
		// Listen for connection state changes
		this.gateway.onStateChanged(this.onConnectionStateChanged.bind(this));
		
		context.subscriptions.push(
			this.soulStatusItem,
			this.agentStatusItem,
			this.connectionStatusItem,
			this.restartItem
		);
	}
	
	private setupStatusItems(): void {
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
		
		// Show all items
		const config = vscode.workspace.getConfiguration('clawsouls');
		if (config.get('showStatusBar', true)) {
			this.soulStatusItem.show();
			this.agentStatusItem.show();
			this.connectionStatusItem.show();
			this.restartItem.show();
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
				this.connectionStatusItem.text = '🔴 error';
				this.connectionStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
				this.connectionStatusItem.command = 'clawsouls.restartGateway';
				this.connectionStatusItem.tooltip = 'Gateway error - click to restart';
				break;
				
			case 'disconnected':
				this.connectionStatusItem.text = '⚪ disconnected';
				this.connectionStatusItem.backgroundColor = undefined;
				this.connectionStatusItem.command = 'clawsouls.restartGateway';
				this.connectionStatusItem.tooltip = 'Gateway disconnected - click to reconnect';
				break;
		}
	}
	
	private getCurrentSoulName(): string {
		// Try to read soul name from workspace
		const workspaces = vscode.workspace.workspaceFolders;
		if (workspaces && workspaces.length > 0) {
			try {
				const soulJsonPath = vscode.Uri.joinPath(workspaces[0].uri, 'soul.json');
				const content = vscode.workspace.fs.readFile(soulJsonPath);
				content.then((data) => {
					try {
						const soulConfig = JSON.parse(data.toString());
						const soulName = soulConfig.name || soulConfig.id || 'Unknown';
						this.soulStatusItem.text = `🔮 ${soulName}`;
					} catch (error) {
						// Ignore parsing errors
					}
				}).catch(() => {
					// File doesn't exist, use default
				});
			} catch (error) {
				// Ignore file reading errors
			}
		}
		
		return 'No Soul'; // Default if no soul.json found
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