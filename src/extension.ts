import * as vscode from 'vscode';
import { GatewayConnection } from './gateway/connection';
import { ChatPanel } from './ui/chatPanel';
import { SoulExplorerProvider } from './ui/soulExplorer';
import { StatusBarManager } from './ui/statusBar';
import { WorkspaceTracker } from './context/workspaceTracker';
import { setupWizard } from './commands/setup';

export let gatewayConnection: GatewayConnection;
export let chatPanel: ChatPanel;
export let workspaceTracker: WorkspaceTracker;

export async function activate(context: vscode.ExtensionContext) {
	console.log('ClawSouls Agent activated');

	// Initialize workspace tracker
	workspaceTracker = new WorkspaceTracker(context);
	
	// Initialize Gateway connection
	gatewayConnection = new GatewayConnection(context);
	
	// Initialize chat panel
	chatPanel = new ChatPanel(context, gatewayConnection);
	
	// Initialize status bar
	const statusBar = new StatusBarManager(context, gatewayConnection);
	
	// Initialize Soul Explorer
	const soulExplorerProvider = new SoulExplorerProvider(context);
	vscode.window.createTreeView('clawsouls.soulExplorer', {
		treeDataProvider: soulExplorerProvider
	});

	// Register commands
	const commands = [
		vscode.commands.registerCommand('clawsouls.setup', setupWizard),
		vscode.commands.registerCommand('clawsouls.openChat', () => chatPanel.show()),
		vscode.commands.registerCommand('clawsouls.restartGateway', () => gatewayConnection.restart()),
		vscode.commands.registerCommand('clawsouls.refresh', () => {
			soulExplorerProvider.refresh();
		}),
		vscode.commands.registerCommand('clawsouls.initSwarm', async () => {
			vscode.window.showInformationMessage('Swarm init - Coming soon!');
		}),
		vscode.commands.registerCommand('clawsouls.joinAgent', async () => {
			vscode.window.showInformationMessage('Join agent - Coming soon!');
		}),
		vscode.commands.registerCommand('clawsouls.pushChanges', async () => {
			vscode.window.showInformationMessage('Push changes - Coming soon!');
		}),
		vscode.commands.registerCommand('clawsouls.pullLatest', async () => {
			vscode.window.showInformationMessage('Pull latest - Coming soon!');
		}),
		vscode.commands.registerCommand('clawsouls.mergeBranches', async () => {
			vscode.window.showInformationMessage('Merge branches - Coming soon!');
		}),
		vscode.commands.registerCommand('clawsouls.runScan', async () => {
			vscode.window.showInformationMessage('Run scan - Coming soon!');
		}),
		vscode.commands.registerCommand('clawsouls.createCheckpoint', async () => {
			vscode.window.showInformationMessage('Create checkpoint - Coming soon!');
		})
	];

	context.subscriptions.push(...commands);

	// Auto-connect if enabled
	const config = vscode.workspace.getConfiguration('clawsouls');
	if (config.get('autoConnect', true)) {
		await gatewayConnection.connect();
	}

	// Show setup wizard on first run
	const hasSetup = context.globalState.get('hasSetup', false);
	if (!hasSetup) {
		await setupWizard();
		context.globalState.update('hasSetup', true);
	}
}

export function deactivate() {
	console.log('ClawSouls Agent deactivated');
	
	if (gatewayConnection) {
		gatewayConnection.disconnect();
	}
	
	if (chatPanel) {
		chatPanel.dispose();
	}
}