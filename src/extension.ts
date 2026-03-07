import * as vscode from 'vscode';
import { GatewayConnection } from './gateway/connection';
import { ChatPanel } from './ui/chatPanel';
import { SoulExplorerProvider } from './ui/soulExplorer';
import { StatusBarManager } from './ui/statusBar';
import { WorkspaceTracker } from './context/workspaceTracker';
import { CheckpointProvider } from './ui/checkpointPanel';
import { SwarmProvider } from './ui/swarmPanel';
import { ChatHistoryProvider } from './ui/chatHistoryPanel';
import { setupWizard } from './commands/setup';
import { GatewayLauncher } from './gateway/launcher';
import { initStateDir } from './paths';

export let gatewayConnection: GatewayConnection;
export let gatewayLauncher: GatewayLauncher;
export let chatPanel: ChatPanel;
export let workspaceTracker: WorkspaceTracker;
export let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
	_context = context;
	// Initialize contained state directory
	initStateDir(context);
	// Create output channel (shows in OUTPUT panel Tasks dropdown)
	outputChannel = vscode.window.createOutputChannel('SoulClaw');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('SoulClaw v0.1.0 activated');
	console.log('SoulClaw activated');

	// Register ALL commands first — before anything that might throw
	context.subscriptions.push(
		vscode.commands.registerCommand('clawsouls.setup', async () => {
			// Stop everything cleanly
			if (gatewayConnection?.currentState === 'connected' || gatewayConnection?.currentState === 'connecting') {
				gatewayConnection.disconnect();
			}
			if (gatewayLauncher?.isRunning()) {
				gatewayLauncher.stop();
			}
			outputChannel.appendLine('Gateway stopped for setup');
			// Wait for port to free
			await new Promise(r => setTimeout(r, 2000));
			
			const result = await setupWizard();
			outputChannel.appendLine(`Setup ${result.completed ? 'completed' : 'cancelled'} — starting Gateway...`);
			await restartGateway();
		}),
		vscode.commands.registerCommand('clawsouls.openChat', () => chatPanel?.show()),
		vscode.commands.registerCommand('clawsouls.clearChat', () => chatPanel?.clearChat()),
		vscode.commands.registerCommand('clawsouls.switchHistory', () => chatPanel?.switchHistory()),
		vscode.commands.registerCommand('clawsouls.restartGateway', () => gatewayConnection?.restart()),
		vscode.commands.registerCommand('clawsouls.connect', async () => {
			if (gatewayLauncher?.gatewayToken) {
				gatewayConnection?.setToken(gatewayLauncher.gatewayToken);
			}
			outputChannel.appendLine('Manual connect triggered');
			gatewayConnection?.disconnect();
			await gatewayConnection?.connect();
		}),
		// clawsouls.refresh is registered by SoulExplorerProvider
		vscode.commands.registerCommand('clawsouls.runScan', async () => {
			const ws = vscode.workspace.workspaceFolders;
			if (!ws) { vscode.window.showWarningMessage('No workspace open'); return; }
			const dir = ws[0].uri.fsPath;
			const terminal = vscode.window.createTerminal({ name: 'SoulScan', cwd: dir });
			terminal.show();
			terminal.sendText('npx clawsouls scan');
		}),
		vscode.commands.registerCommand('clawsouls.editSoul', async () => {
			const ws = vscode.workspace.workspaceFolders;
			if (!ws) return;
			const fs = require('fs');
			const pathMod = require('path');
			const soulPath = pathMod.join(ws[0].uri.fsPath, 'soul.json');
			if (!fs.existsSync(soulPath)) {
				const create = await vscode.window.showInformationMessage('No soul.json found. Create one?', 'Create', 'Cancel');
				if (create !== 'Create') return;
				fs.writeFileSync(soulPath, JSON.stringify({
					specVersion: "0.5",
					name: "my-soul",
					displayName: "My Soul",
					version: "0.1.0",
					description: "",
					persona: { identity: "", style: "" }
				}, null, 2));
			}
			const doc = await vscode.workspace.openTextDocument(soulPath);
			await vscode.window.showTextDocument(doc);
		}),
		// clawsouls.initSwarm, joinAgent, pushChanges, pullLatest, mergeBranches → SwarmProvider
		// clawsouls.createCheckpoint → CheckpointProvider
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
		// Initialize Chat History panel
		const chatHistoryProvider = new ChatHistoryProvider(context);
		vscode.window.createTreeView('clawsouls.chatHistory', {
			treeDataProvider: chatHistoryProvider
		});

		const soulExplorerProvider = new SoulExplorerProvider(context);
		vscode.window.createTreeView('clawsouls.soulExplorer', {
			treeDataProvider: soulExplorerProvider
		});

		// Initialize Swarm panel
		const swarmProvider = new SwarmProvider(context);
		vscode.window.createTreeView('clawsouls.swarm', {
			treeDataProvider: swarmProvider
		});

		// Initialize Checkpoint panel
		const checkpointProvider = new CheckpointProvider(context);
		vscode.window.createTreeView('clawsouls.checkpoints', {
			treeDataProvider: checkpointProvider
		});

		// First run: show setup wizard, wait for completion, then start gateway
		const hasSetup = context.globalState.get('hasSetup', false);
		if (!hasSetup) {
			outputChannel.appendLine('First run — opening setup wizard...');
			const result = await setupWizard();
			context.globalState.update('hasSetup', true);
			outputChannel.appendLine(`Setup ${result.completed ? 'completed' : 'skipped'} — starting Gateway...`);
		}

		// Launch gateway and connect
		await restartGateway();

		outputChannel.appendLine('Fully initialized');
	} catch (err) {
		outputChannel.appendLine(`Activation error: ${err}`);
		console.error('SoulClaw activation error:', err);
	}
}

let _context: vscode.ExtensionContext;

async function restartGateway(): Promise<void> {
	const config = vscode.workspace.getConfiguration('clawsouls');
	if (!config.get('autoConnect', true)) return;

	if (!gatewayLauncher) {
		gatewayLauncher = new GatewayLauncher(_context);
	}

	outputChannel.appendLine('Ensuring Gateway is running...');
	await gatewayLauncher.ensureRunning();

	if (gatewayLauncher.gatewayToken) {
		gatewayConnection.setToken(gatewayLauncher.gatewayToken);
	}

	outputChannel.appendLine('Connecting to Gateway...');
	let connected = false;
	for (let i = 0; i < 6; i++) {
		try {
			await gatewayConnection.connect();
			await new Promise(r => setTimeout(r, 3000));
			if (gatewayConnection.currentState === 'connected') {
				connected = true;
				break;
			}
			gatewayConnection.disconnect();
		} catch {}
		outputChannel.appendLine(`Connection attempt ${i + 1} failed, retrying in 5s...`);
		await new Promise(r => setTimeout(r, 5000));
	}
	if (!connected) {
		outputChannel.appendLine('Could not connect to Gateway after retries');
	}
}

export function deactivate() {
	console.log('SoulClaw deactivated');
	
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