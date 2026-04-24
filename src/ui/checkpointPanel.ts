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
	hashes?: Record<string, string>;
	score?: number;
}

/** Minimum score for a checkpoint to be considered "clean" during auto-restore. */
const CLEAN_THRESHOLD = 75;

export class CheckpointProvider implements vscode.TreeDataProvider<CheckpointNode | CheckpointActionNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<CheckpointNode | CheckpointActionNode | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private checkpoints: CheckpointInfo[] = [];

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand('clawsouls.createCheckpoint', () => this.createCheckpoint()),
			vscode.commands.registerCommand('clawsouls.checkpoint.restore', (node: CheckpointNode) => this.restoreCheckpoint(node)),
			vscode.commands.registerCommand('clawsouls.checkpoint.delete', (node: CheckpointNode) => this.deleteCheckpoint(node)),
			vscode.commands.registerCommand('clawsouls.checkpoint.diff', (node: CheckpointNode) => this.diffCheckpoint(node)),
			vscode.commands.registerCommand('clawsouls.checkpoint.autoRestore', () => this.autoRestore())
		);

		this.loadCheckpoints();
	}

	refresh(): void {
		this.loadCheckpoints();
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: CheckpointNode | CheckpointActionNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: CheckpointNode): (CheckpointNode | CheckpointActionNode)[] {
		if (element) return [];
		const items: (CheckpointNode | CheckpointActionNode)[] = this.checkpoints.map(cp => new CheckpointNode(cp));
		items.push(new CheckpointActionNode('➕ Create Checkpoint', 'clawsouls.createCheckpoint'));
		return items;
	}

	/** SoulClaw workspace where soul files live */
	private getWorkspaceDirectory(): string {
		const { getWorkspaceDir } = require('../paths');
		return getWorkspaceDir();
	}

	/** Checkpoints stored alongside soul files in {stateDir}/workspace/.clawsouls/checkpoints/ */
	private getCheckpointDir(): string {
		return path.join(this.getWorkspaceDirectory(), '.clawsouls', 'checkpoints');
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
								hashes: meta.hashes,
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

	/**
	 * Auto-restore flow per patent APP2026-0325 claim 1 ⑤+⑥.
	 *
	 * Runs the multi-layer SoulScan pipeline against the current workspace
	 * state. If the score falls below the clean threshold, walks the
	 * checkpoint history newest-first (claim ⑤ — identify the first
	 * contamination point) and offers restoration from the most recent
	 * checkpoint that was clean at capture time (claim ⑥). Always confirms
	 * with the user before overwriting, and takes a safety checkpoint of
	 * the contaminated state first so the restore can itself be undone.
	 */
	async autoRestore(options: { silent?: boolean } = {}): Promise<void> {
		const workspaceDir = this.getWorkspaceDirectory();

		// Claim ③ + ④ — run multi-layer contamination scan + judgment.
		let currentResult: { score: number } | null = null;
		try {
			const { scanSoulFiles } = require('../engine/soulscan');
			currentResult = scanSoulFiles(workspaceDir);
		} catch (err: any) {
			if (!options.silent) {
				vscode.window.showErrorMessage(`Auto-restore: SoulScan failed — ${err.message}`);
			}
			return;
		}

		if (!currentResult || currentResult.score >= CLEAN_THRESHOLD) {
			if (!options.silent) {
				const score = currentResult?.score ?? 'unknown';
				vscode.window.showInformationMessage(
					`SoulScan score: ${score}/100 — no contamination detected, no restore needed.`
				);
			}
			return;
		}

		// Claim ⑤ — walk checkpoint history newest-first; pick first clean.
		this.loadCheckpoints();
		const target = this.checkpoints.find(cp =>
			typeof cp.score === 'number' && cp.score >= CLEAN_THRESHOLD
		);

		if (!target) {
			vscode.window.showWarningMessage(
				`⚠️ Contamination detected (score: ${currentResult.score}/100) but no clean checkpoint exists in history. Create a clean checkpoint first.`
			);
			return;
		}

		// Confirm with user — auto-restore still requires consent.
		const confirm = await vscode.window.showWarningMessage(
			`⚠️ Contamination detected: current score ${currentResult.score}/100 (< ${CLEAN_THRESHOLD}).\n\n` +
				`Last clean checkpoint: "${target.label}" (score: ${target.score}).\n\n` +
				`Restore now? A safety checkpoint of the current state will be created first.`,
			{ modal: true },
			'Restore from last clean'
		);
		if (confirm !== 'Restore from last clean') return;

		// Safety: auto-checkpoint current (contaminated) state before overwriting.
		await this.createCheckpointSilent(`auto-before-restore (contaminated, score ${currentResult.score})`);

		// Claim ⑥ — restore from identified target checkpoint (no extra confirm).
		const targetNode = new CheckpointNode(target);
		await this.restoreCheckpointInternal(targetNode, /* skipConfirm */ true);
	}

	/**
	 * Non-interactive checkpoint creation used by auto-restore to protect
	 * the contaminated state before it gets overwritten. Same machinery as
	 * createCheckpoint() minus the input prompt.
	 */
	private async createCheckpointSilent(label: string): Promise<void> {
		const rootDir = this.getWorkspaceDirectory();
		const soulFiles = ['soul.json', 'SOUL.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md', 'HEARTBEAT.md', 'STYLE.md'];
		const existingFiles: string[] = [];
		for (const f of soulFiles) {
			if (fs.existsSync(path.join(rootDir, f))) existingFiles.push(f);
		}
		if (existingFiles.length === 0) return;

		const cpId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const cpDir = path.join(this.getCheckpointDir(), cpId);
		fs.mkdirSync(cpDir, { recursive: true });

		const hashes: Record<string, string> = {};
		for (const f of existingFiles) {
			const src = path.join(rootDir, f);
			const dst = path.join(cpDir, f);
			fs.copyFileSync(src, dst);
			const content = fs.readFileSync(src);
			hashes[f] = crypto.createHash('sha256').update(content).digest('hex');
		}

		let scanScore: number | undefined;
		try {
			const { scanSoulFiles } = require('../engine/soulscan');
			const result = scanSoulFiles(rootDir);
			scanScore = result.score;
		} catch {}

		const meta = {
			label,
			timestamp: new Date().toISOString(),
			files: existingFiles,
			hashes,
			score: scanScore,
		};
		fs.writeFileSync(path.join(cpDir, 'checkpoint.json'), JSON.stringify(meta, null, 2));
		this.refresh();
	}

	private async createCheckpoint(): Promise<void> {
		const label = await vscode.window.showInputBox({
			prompt: 'Checkpoint label (optional)',
			placeHolder: 'e.g. before-refactor, stable-v1'
		});
		if (label === undefined) return; // cancelled

		const rootDir = this.getWorkspaceDirectory();
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

		// Run embedded SoulScan for contamination score
		let scanScore: number | undefined;
		try {
			const { scanSoulFiles } = require('../engine/soulscan');
			const result = scanSoulFiles(rootDir);
			scanScore = result.score;
		} catch {}

		// Write metadata
		const meta = {
			label: label || cpId,
			timestamp: new Date().toISOString(),
			files: existingFiles,
			hashes,
			score: scanScore,
		};
		fs.writeFileSync(path.join(cpDir, 'checkpoint.json'), JSON.stringify(meta, null, 2));

		const scoreText = scanScore !== undefined ? ` · Score: ${scanScore}/100` : '';
		vscode.window.showInformationMessage(`✅ Checkpoint "${meta.label}" created (${existingFiles.length} files${scoreText}).`);
		this.refresh();
	}

	private async restoreCheckpoint(node: CheckpointNode): Promise<void> {
		await this.restoreCheckpointInternal(node, /* skipConfirm */ false);
	}

	/**
	 * Restore implementation with optional confirm skip. Verifies SHA-256
	 * hashes of every file in the checkpoint against the recorded meta
	 * before touching the workspace — tampered / corrupted checkpoints
	 * abort cleanly instead of silently writing bad data back.
	 */
	private async restoreCheckpointInternal(node: CheckpointNode, skipConfirm: boolean): Promise<void> {
		if (!skipConfirm) {
			const confirm = await vscode.window.showWarningMessage(
				`Restore checkpoint "${node.cp.label}"? This will overwrite current soul files.`,
				{ modal: true },
				'Restore'
			);
			if (confirm !== 'Restore') return;
		}

		const rootDir = this.getWorkspaceDirectory();
		const cpDir = path.join(this.getCheckpointDir(), node.cp.id);

		// Integrity verification — every file's SHA-256 must match the
		// hash recorded in meta.hashes. Older checkpoints without hashes
		// fall back to a permissive path with a warning, so historical
		// snapshots keep working after this upgrade.
		const meta = node.cp.hashes;
		if (meta) {
			const mismatches: string[] = [];
			for (const f of node.cp.files) {
				const src = path.join(cpDir, f);
				if (!fs.existsSync(src)) continue;
				const actual = crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');
				const expected = meta[f];
				if (expected && actual !== expected) {
					mismatches.push(`${f} (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
				}
			}
			if (mismatches.length > 0) {
				vscode.window.showErrorMessage(
					`❌ Checkpoint integrity check failed — restore aborted. Mismatched files: ${mismatches.join(', ')}`
				);
				return;
			}
		} else {
			vscode.window.showWarningMessage(
				`⚠️ Checkpoint "${node.cp.label}" has no stored hashes — integrity check skipped. Restoring anyway.`
			);
		}

		for (const f of node.cp.files) {
			const src = path.join(cpDir, f);
			const dst = path.join(rootDir, f);
			if (fs.existsSync(src)) {
				fs.copyFileSync(src, dst);
			}
		}

		vscode.window.showInformationMessage(`✅ Restored checkpoint "${node.cp.label}". Restarting engine...`);

		// Restart engine so it picks up restored soul files
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
		const rootDir = this.getWorkspaceDirectory();
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
		const scoreText = cp.score !== undefined ? ` · ${cp.score >= 75 ? '✅' : cp.score >= 50 ? '⚠️' : '❌'} ${cp.score}` : '';
		this.description = `${date} · ${cp.files.length} files${scoreText}`;
		this.tooltip = `ID: ${cp.id}\nCreated: ${date}\nFiles: ${cp.files.join(', ')}${cp.score !== undefined ? `\nScan Score: ${cp.score}/100` : ''}`;
		this.iconPath = new vscode.ThemeIcon('history');
		this.contextValue = 'checkpoint';
	}
}

class CheckpointActionNode extends vscode.TreeItem {
	constructor(label: string, commandId: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.command = { command: commandId, title: label };
		this.iconPath = new vscode.ThemeIcon('add');
		this.contextValue = 'checkpointAction';
	}
}
