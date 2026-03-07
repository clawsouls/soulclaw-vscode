import * as vscode from 'vscode';
import { SoulClawEngine } from './engine';
import { ChatPanel } from './ui/chatPanel';
import { SoulExplorerProvider } from './ui/soulExplorer';
import { StatusBarManager } from './ui/statusBar';
import { WorkspaceTracker } from './context/workspaceTracker';
import { CheckpointProvider } from './ui/checkpointPanel';
import { SwarmProvider } from './ui/swarmPanel';
import { ChatHistoryProvider } from './ui/chatHistoryPanel';
import { setupWizard } from './commands/setup';
import { registerCodeActions } from './commands/codeActions';
import { SoulClawCodeLensProvider } from './providers/codeLensProvider';
import { initStateDir, getStateDir, getWorkspaceDir } from './paths';

export let engine: SoulClawEngine;
export let chatPanel: ChatPanel;
export let workspaceTracker: WorkspaceTracker;
export let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
	_context = context;
	// Initialize contained state directory
	initStateDir(context);
	// Create output channel
	outputChannel = vscode.window.createOutputChannel('SoulClaw');
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('SoulClaw v0.5.0 activated (embedded engine)');

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('clawsouls.setup', async () => {
			const result = await setupWizard();
			outputChannel.appendLine(`Setup ${result.completed ? 'completed' : 'cancelled'}`);
			if (result.completed) {
				await restartEngine();
			}
		}),
		vscode.commands.registerCommand('clawsouls.openChat', () => chatPanel?.show()),
		vscode.commands.registerCommand('clawsouls.clearChat', () => chatPanel?.clearChat()),
		vscode.commands.registerCommand('clawsouls.switchHistory', () => chatPanel?.switchHistory()),
		vscode.commands.registerCommand('clawsouls.restartGateway', () => restartEngine()),
		vscode.commands.registerCommand('clawsouls.connect', () => restartEngine()),
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
	);
	// Register code actions (Ask/Explain/Fix/AddToContext)
	registerCodeActions(context);

	// Register CodeLens provider
	const codeLensProvider = new SoulClawCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
	);

	outputChannel.appendLine('Commands registered');

	try {
		// Initialize workspace tracker
		workspaceTracker = new WorkspaceTracker(context);

		// Initialize engine
		engine = new SoulClawEngine();

		// Initialize chat panel (uses engine directly)
		chatPanel = new ChatPanel(context, engine);

		// Initialize status bar
		const statusBar = new StatusBarManager(context, engine);

		// Initialize Chat History panel
		const chatHistoryProvider = new ChatHistoryProvider(context);
		vscode.window.createTreeView('clawsouls.chatHistory', {
			treeDataProvider: chatHistoryProvider
		});

		// Initialize Soul Explorer
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

		// First run: show setup wizard
		const hasSetup = context.globalState.get('hasSetup', false);
		if (!hasSetup) {
			outputChannel.appendLine('First run — opening setup wizard...');
			const result = await setupWizard();
			context.globalState.update('hasSetup', true);
			outputChannel.appendLine(`Setup ${result.completed ? 'completed' : 'skipped'}`);
		}

		// Start engine
		await restartEngine();

		outputChannel.appendLine('Fully initialized');
	} catch (err) {
		outputChannel.appendLine(`Activation error: ${err}`);
		console.error('SoulClaw activation error:', err);
	}
}

let _context: vscode.ExtensionContext;

async function restartEngine(): Promise<void> {
	const config = vscode.workspace.getConfiguration('clawsouls');
	if (!config.get('autoConnect', true)) return;

	outputChannel.appendLine('Starting SoulClaw engine...');

	try {
		if (engine.state !== 'idle') {
			engine.dispose();
		}

		const llmProvider = config.get<string>('llmProvider', 'anthropic') as 'anthropic' | 'openai' | 'ollama';
		const llmApiKey = config.get<string>('llmApiKey', '');
		const llmModel = config.get<string>('llmModel', '');
		const ollamaUrl = config.get<string>('ollamaUrl', 'http://127.0.0.1:11434');
		const ollamaModel = config.get<string>('ollamaModel', 'llama3');

		await engine.init({
			stateDir: getStateDir(),
			workspaceDir: getWorkspaceDir(),
			llmProvider,
			llmApiKey: llmApiKey || undefined,
			llmModel: llmModel || (llmProvider === 'ollama' ? ollamaModel : undefined),
			ollamaUrl,
		});

		outputChannel.appendLine(`Engine ready (provider: ${llmProvider}, model: ${engine['llm']?.model || 'default'})`);
	} catch (err: any) {
		outputChannel.appendLine(`Engine start failed: ${err.message}`);
	}
}

export function deactivate() {
	console.log('SoulClaw deactivated');
	if (engine) {
		engine.dispose();
	}
	if (chatPanel) {
		chatPanel.dispose();
	}
}
