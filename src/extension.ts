import * as vscode from 'vscode';
import { SoulClawEngine } from './engine';
import { setupTelegram } from './commands/setup';
import { ChatPanel } from './ui/chatPanel';
import { SoulExplorerProvider } from './ui/soulExplorer';
import { StatusBarManager } from './ui/statusBar';
import { WorkspaceTracker } from './context/workspaceTracker';
import { CheckpointProvider } from './ui/checkpointPanel';
import { SwarmProvider } from './ui/swarmPanel';
import { ChatHistoryProvider } from './ui/chatHistoryPanel';
import { SoulScanProvider } from './ui/soulscanPanel';
import { setupWizard } from './commands/setup';
import { registerCodeActions } from './commands/codeActions';
import { SoulClawCodeLensProvider } from './providers/codeLensProvider';
import { initStateDir, getStateDir, getWorkspaceDir } from './paths';
import { TelegramRelay } from './integrations/telegram';

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
	(globalThis as any).__soulclawOutput = outputChannel;
	context.subscriptions.push(outputChannel);
	outputChannel.appendLine('SoulClaw v0.6.0 activated (embedded engine)');

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
		vscode.commands.registerCommand('clawsouls.loadHistory', (key: string, wsName: string) => chatPanel?.loadHistory(key, wsName)),
		vscode.commands.registerCommand('clawsouls.clearSessions', () => engine?.clearSessions()),
		vscode.commands.registerCommand('clawsouls.setupTelegram', () => setupTelegram()),
		vscode.commands.registerCommand('clawsouls.switchHistory', () => chatPanel?.switchHistory()),
		vscode.commands.registerCommand('clawsouls.restartGateway', () => restartEngine()),
		vscode.commands.registerCommand('clawsouls.connect', () => restartEngine()),
		vscode.commands.registerCommand('clawsouls.runScan', async () => {
			if ((globalThis as any).__soulScanProvider) {
				const provider = (globalThis as any).__soulScanProvider as SoulScanProvider;
				provider.runScan();
				const result = provider.getLastResult();
				if (result) {
					outputChannel.appendLine(`SoulScan result: ${result.grade} (${result.score}/100), ${result.issues.length} issues`);
					if (result.fileCount === 0) {
						vscode.window.showWarningMessage('No soul files found to scan.');
					} else {
						const msg = `SoulScan: ${result.grade} (${result.score}/100) — ${result.fileCount} files, ${result.issues.length} issue(s)`;
						if (result.score >= 75) {
							vscode.window.showInformationMessage(msg);
						} else {
							vscode.window.showWarningMessage(msg);
						}
					}
				}
			}
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

		// Initialize SoulScan panel
		const soulscanProvider = new SoulScanProvider(context);
		(globalThis as any).__soulScanProvider = soulscanProvider;
		vscode.window.createTreeView('clawsouls.soulscan', {
			treeDataProvider: soulscanProvider
		});

		// Auto-checkpoint on soul file save
		const soulFileWatcher = vscode.workspace.createFileSystemWatcher('**/SOUL.md');
		soulFileWatcher.onDidChange(async () => {
			const config = vscode.workspace.getConfiguration('clawsouls');
			outputChannel.appendLine('Soul file changed — creating auto-checkpoint');
			try {
				await vscode.commands.executeCommand('clawsouls.createCheckpoint');
			} catch {}
		});
		context.subscriptions.push(soulFileWatcher);

		// Scan-on-save
		context.subscriptions.push(
			vscode.workspace.onDidSaveTextDocument(async (doc) => {
				const config = vscode.workspace.getConfiguration('clawsouls');
				if (!config.get('scanOnSave', true)) return;
				if (doc.fileName.endsWith('soul.json') || doc.fileName.endsWith('SOUL.md')) {
					outputChannel.appendLine(`SoulScan triggered by save: ${doc.fileName}`);
					// Lightweight inline scan — just check for obvious issues
					const content = doc.getText();
					const issues: string[] = [];
					if (content.includes('sk-ant-') || content.includes('sk-')) {
						issues.push('⚠️ Possible API key detected in soul file');
					}
					if (content.length > 50000) {
						issues.push('⚠️ File exceeds 50KB — consider splitting');
					}
					if (issues.length > 0) {
						vscode.window.showWarningMessage(`SoulScan: ${issues.join('; ')}`);
					}
				}
			})
		);

		// Stop generation command
		context.subscriptions.push(
			vscode.commands.registerCommand('soulclaw.stopGeneration', () => {
				engine.abort();
			})
		);

		// Watch config changes — auto restart engine
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('clawsouls')) {
					outputChannel.appendLine('Config changed — restarting engine...');
					restartEngine();
				}
			})
		);

		// First run: show setup wizard
		const hasSetup = context.globalState.get('hasSetup', false);
		if (!hasSetup) {
			outputChannel.appendLine('First run — opening setup wizard...');
			const result = await setupWizard();
			context.globalState.update('hasSetup', true);
			outputChannel.appendLine(`Setup ${result.completed ? 'completed' : 'skipped'}`);
		}

		// Telegram relay — start/restart function
		let telegram: TelegramRelay | null = null;
		function startTelegramRelay() {
			if (telegram) { telegram.stop(); }
			telegram = new TelegramRelay(getStateDir());
			if (telegram.loadConfig()) {
				telegram.start(async (text, from) => {
					outputChannel.appendLine(`[telegram] ${from}: ${text}`);
					chatPanel?.addMessage('user', `📱 [${from} via Telegram]: ${text}`);
					try {
						outputChannel.appendLine(`[telegram] sending to engine...`);
						const response = await engine.sendMessage(text);
						outputChannel.appendLine(`[telegram] engine response (${response.length} chars): ${response.slice(0, 200)}`);
						if (response) {
							const sent = await telegram.send(response);
							outputChannel.appendLine(`[telegram] relay to telegram: ${sent ? 'ok' : 'FAILED'}`);
						}
					} catch (err: any) {
						outputChannel.appendLine(`[telegram] engine error: ${err.message}`);
						try { await telegram.send(`⚠️ Error: ${err.message}`); } catch {}
					}
				});
				(globalThis as any).__soulclawTelegram = telegram;
				outputChannel.appendLine('Telegram relay started');
			} else {
				outputChannel.appendLine('Telegram relay: no config found');
			}
		}
		startTelegramRelay();
		// Update status bar after relay has started
		setTimeout(() => statusBar.updateTelegramStatus(), 500);
		context.subscriptions.push({ dispose: () => telegram?.stop() });

		// Re-start relay after setup saves config
		context.subscriptions.push(
			vscode.commands.registerCommand('clawsouls.restartTelegram', async () => {
				outputChannel.appendLine('Telegram relay restarting...');
				startTelegramRelay();
				// Small delay to ensure relay object is set before status check
				await new Promise(r => setTimeout(r, 200));
				statusBar.updateTelegramStatus();
				outputChannel.appendLine(`Telegram status: ${(globalThis as any).__soulclawTelegram ? 'active' : 'inactive'}`);
			})
		);

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
		const llmModel = config.get<string>('llmModel', '');
		const ollamaUrl = config.get<string>('ollamaUrl', 'http://127.0.0.1:11434');
		const ollamaModel = config.get<string>('ollamaModel', 'llama3');

		// Try SecretStorage first, fall back to Settings
		let llmApiKey = await _context.secrets.get('clawsouls.llmApiKey') || '';
		if (!llmApiKey) {
			llmApiKey = config.get<string>('llmApiKey', '');
			// Migrate to SecretStorage if found in Settings
			if (llmApiKey) {
				await _context.secrets.store('clawsouls.llmApiKey', llmApiKey);
				await config.update('llmApiKey', undefined, vscode.ConfigurationTarget.Global);
				outputChannel.appendLine('API key migrated to SecretStorage');
			}
		}

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
