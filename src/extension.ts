import * as vscode from 'vscode';
import { GatewayConnection } from './gateway/connection';
import { ChatPanel } from './ui/chatPanel';
import { SoulExplorerProvider } from './ui/soulExplorer';
import { StatusBarManager } from './ui/statusBar';
import { WorkspaceTracker } from './context/workspaceTracker';
import { setupWizard } from './commands/setup';
import { GatewayLauncher } from './gateway/launcher';

export let gatewayConnection: GatewayConnection;
export let gatewayLauncher: GatewayLauncher;
export let chatPanel: ChatPanel;
export let workspaceTracker: WorkspaceTracker;
export let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
	// Create output channel (shows in OUTPUT panel Tasks dropdown)
	outputChannel = vscode.window.createOutputChannel('ClawSouls Agent');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('ClawSouls Agent v0.1.0 activated');
	console.log('ClawSouls Agent activated');

	// Register ALL commands first — before anything that might throw
	context.subscriptions.push(
		vscode.commands.registerCommand('clawsouls.setup', () => {
			if (gatewayConnection?.currentState === 'connected' || gatewayConnection?.currentState === 'connecting') {
				gatewayConnection.disconnect();
				outputChannel.appendLine('Gateway disconnected for setup');
			}
			if (gatewayLauncher?.isRunning()) {
				gatewayLauncher.stop();
				outputChannel.appendLine('Gateway process stopped for setup');
			}
			return setupWizard();
		}),
		vscode.commands.registerCommand('clawsouls.openChat', () => chatPanel?.show()),
		vscode.commands.registerCommand('clawsouls.restartGateway', () => gatewayConnection?.restart()),
		vscode.commands.registerCommand('clawsouls.refresh', () => {}),
		vscode.commands.registerCommand('clawsouls.initSwarm', () => vscode.window.showInformationMessage('Swarm init - Coming soon!')),
		vscode.commands.registerCommand('clawsouls.joinAgent', () => vscode.window.showInformationMessage('Join agent - Coming soon!')),
		vscode.commands.registerCommand('clawsouls.pushChanges', () => vscode.window.showInformationMessage('Push changes - Coming soon!')),
		vscode.commands.registerCommand('clawsouls.pullLatest', () => vscode.window.showInformationMessage('Pull latest - Coming soon!')),
		vscode.commands.registerCommand('clawsouls.mergeBranches', () => vscode.window.showInformationMessage('Merge branches - Coming soon!')),
		vscode.commands.registerCommand('clawsouls.runScan', () => vscode.window.showInformationMessage('Run scan - Coming soon!')),
		vscode.commands.registerCommand('clawsouls.createCheckpoint', () => vscode.window.showInformationMessage('Create checkpoint - Coming soon!'))
	);
	outputChannel.appendLine('Commands registered');

	try {
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

		// Auto-launch and connect
		const config = vscode.workspace.getConfiguration('clawsouls');
		if (config.get('autoConnect', true)) {
			gatewayLauncher = new GatewayLauncher(context);
			outputChannel.appendLine('Ensuring Gateway is running...');
			await gatewayLauncher.ensureRunning();
			outputChannel.appendLine('Connecting to Gateway...');
			await gatewayConnection.connect();
		}

		// Show setup wizard on first run
		const hasSetup = context.globalState.get('hasSetup', false);
		if (!hasSetup) {
			await setupWizard();
			context.globalState.update('hasSetup', true);
		}

		outputChannel.appendLine('Fully initialized');
	} catch (err) {
		outputChannel.appendLine(`Activation error: ${err}`);
		console.error('ClawSouls Agent activation error:', err);
	}
}

export function deactivate() {
	console.log('ClawSouls Agent deactivated');
	
	if (gatewayLauncher) {
		gatewayLauncher.stop();
	}
	if (gatewayConnection) {
		gatewayConnection.disconnect();
	}
	
	if (chatPanel) {
		chatPanel.dispose();
	}
}