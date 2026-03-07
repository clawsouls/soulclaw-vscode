import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

interface CheckpointInfo {
	id: string;
	label: string;
	timestamp: string;
	files: string[];
	score?: number;
}

export class CheckpointProvider implements vscode.TreeDataProvider<CheckpointNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<CheckpointNode | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private checkpoints: CheckpointInfo[] = [];

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand('clawsouls.createCheckpoint', () => this.createCheckpoint()),
			vscode.commands.registerCommand('clawsouls.checkpoint.restore', (node: CheckpointNode) => this.restoreCheckpoint(node)),
			vscode.commands.registerCommand('clawsouls.checkpoint.delete', (node: CheckpointNode) => this.deleteCheckpoint(node)),
			vscode.commands.registerCommand('clawsouls.checkpoint.diff', (node: CheckpointNode) => this.diffCheckpoint(node))
		);

		this.loadCheckpoints();
	}

	refresh(): void {
		this.loadCheckpoints();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: CheckpointNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: CheckpointNode): CheckpointNode[] {
		if (element) return [];
		return this.checkpoints.map(cp => new CheckpointNode(cp));
	}

	/** OpenClaw workspace where soul files live */
	private getOpenClawWorkspaceDir(): string {
		const { getWorkspaceDir } = require('../paths');
		return getWorkspaceDir();
	}

	/** Checkpoints stored alongside soul files in {stateDir}/workspace/.clawsouls/checkpoints/ */
	private getCheckpointDir(): string {
		return path.join(this.getOpenClawWorkspaceDir(), '.clawsouls', 'checkpoints');
	}

	private loadCheckpoints(): void {
		const dir = this.getCheckpointDir();
		if (!fs.existsSync(dir)) {
			this.checkpoints = [];
			return;
		}

		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			this.checkpoints = entries
				.filter(e => e.isDirectory())
				.map(e => {
					const cpDir = path.join(dir, e.name);
					const metaPath = path.join(cpDir, 'checkpoint.json');
					if (fs.existsSync(metaPath)) {
						try {
							const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
							return {
								id: e.name,
								label: meta.label || e.name,
								timestamp: meta.timestamp || '',
								files: meta.files || [],
								score: meta.score
							};
						} catch {}
					}
					return {
						id: e.name,
						label: e.name,
						timestamp: '',
						files: [],
					};
				})
				.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
		} catch {
			this.checkpoints = [];
		}
	}

	private async createCheckpoint(): Promise<void> {
		const label = await vscode.window.showInputBox({
			prompt: 'Checkpoint label (optional)',
			placeHolder: 'e.g. before-refactor, stable-v1'
		});
		if (label === undefined) return; // cancelled

		const rootDir = this.getOpenClawWorkspaceDir();
		const soulFiles = ['soul.json', 'SOUL.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md', 'HEARTBEAT.md', 'STYLE.md'];
		const existingFiles: string[] = [];

		for (const f of soulFiles) {
			if (fs.existsSync(path.join(rootDir, f))) {
				existingFiles.push(f);
			}
		}

		if (existingFiles.length === 0) {
			vscode.window.showWarningMessage('No soul files found in SoulClaw workspace.');
			return;
		}

		const cpId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const cpDir = path.join(this.getCheckpointDir(), cpId);
		fs.mkdirSync(cpDir, { recursive: true });

		// Copy files
		const hashes: Record<string, string> = {};
		for (const f of existingFiles) {
			const src = path.join(rootDir, f);
			const dst = path.join(cpDir, f);
			fs.copyFileSync(src, dst);
			const content = fs.readFileSync(src);
			hashes[f] = crypto.createHash('sha256').update(content).digest('hex');
		}

		// Write metadata
		const meta = {
			label: label || cpId,
			timestamp: new Date().toISOString(),
			files: existingFiles,
			hashes
		};
		fs.writeFileSync(path.join(cpDir, 'checkpoint.json'), JSON.stringify(meta, null, 2));

		vscode.window.showInformationMessage(`✅ Checkpoint "${meta.label}" created (${existingFiles.length} files).`);
		this.refresh();
	}

	private async restoreCheckpoint(node: CheckpointNode): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			`Restore checkpoint "${node.cp.label}"? This will overwrite current soul files.`,
			{ modal: true },
			'Restore'
		);
		if (confirm !== 'Restore') return;

		const rootDir = this.getOpenClawWorkspaceDir();
		const cpDir = path.join(this.getCheckpointDir(), node.cp.id);

		for (const f of node.cp.files) {
			const src = path.join(cpDir, f);
			const dst = path.join(rootDir, f);
			if (fs.existsSync(src)) {
				fs.copyFileSync(src, dst);
			}
		}

		vscode.window.showInformationMessage(`✅ Restored checkpoint "${node.cp.label}". Restarting gateway...`);

		// Restart gateway so it picks up restored soul files
		try {
			await vscode.commands.executeCommand('clawsouls.restartGateway');
		} catch {
			// Command may not be registered yet — non-fatal
		}
	}

	private async deleteCheckpoint(node: CheckpointNode): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			`Delete checkpoint "${node.cp.label}"?`,
			{ modal: true },
			'Delete'
		);
		if (confirm !== 'Delete') return;

		const cpDir = path.join(this.getCheckpointDir(), node.cp.id);
		fs.rmSync(cpDir, { recursive: true, force: true });

		vscode.window.showInformationMessage(`Checkpoint "${node.cp.label}" deleted.`);
		this.refresh();
	}

	private async diffCheckpoint(node: CheckpointNode): Promise<void> {
		const rootDir = this.getOpenClawWorkspaceDir();
		const cpDir = path.join(this.getCheckpointDir(), node.cp.id);

		// Let user pick a file to diff
		const files = node.cp.files.filter(f => fs.existsSync(path.join(cpDir, f)) && fs.existsSync(path.join(rootDir, f)));
		if (files.length === 0) {
			vscode.window.showInformationMessage('No comparable files found.');
			return;
		}

		const picked = await vscode.window.showQuickPick(files, { placeHolder: 'Select file to diff' });
		if (!picked) return;

		const cpUri = vscode.Uri.file(path.join(cpDir, picked));
		const curUri = vscode.Uri.file(path.join(rootDir, picked));
		vscode.commands.executeCommand('vscode.diff', cpUri, curUri, `${picked}: checkpoint vs current`);
	}
}

class CheckpointNode extends vscode.TreeItem {
	constructor(public readonly cp: CheckpointInfo) {
		super(cp.label, vscode.TreeItemCollapsibleState.None);

		const date = cp.timestamp ? new Date(cp.timestamp).toLocaleString() : 'unknown';
		this.description = `${date} · ${cp.files.length} files`;
		this.tooltip = `ID: ${cp.id}\nCreated: ${date}\nFiles: ${cp.files.join(', ')}`;
		this.iconPath = new vscode.ThemeIcon('history');
		this.contextValue = 'checkpoint';
	}
}
