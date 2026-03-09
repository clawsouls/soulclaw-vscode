import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

interface SwarmBranch {
	name: string;
	current: boolean;
}

type SwarmNode = SwarmBranchNode | SwarmActionNode;

export class SwarmProvider implements vscode.TreeDataProvider<SwarmNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<SwarmNode | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private initialized = false;
	private branches: SwarmBranch[] = [];
	private hasConflicts = false;
	private conflictedFiles: string[] = [];

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand('clawsouls.initSwarm', () => this.initSwarm()),
			vscode.commands.registerCommand('clawsouls.swarmKeys', () => this.manageKeys()),
			vscode.commands.registerCommand('clawsouls.pushChanges', () => this.pushWithSync()),
			vscode.commands.registerCommand('clawsouls.pullLatest', () => this.pullWithSync()),
			vscode.commands.registerCommand('clawsouls.mergeBranches', () => this.mergeBranches()),
			vscode.commands.registerCommand('clawsouls.joinAgent', () => this.joinAgent()),
			vscode.commands.registerCommand('clawsouls.swarm.switchBranch', (node: SwarmBranchNode) => this.switchBranch(node)),
			vscode.commands.registerCommand('clawsouls.swarm.deleteBranch', (node: SwarmBranchNode) => this.deleteBranch(node))
		);

		this.detectSwarm();

		// Initial memory sync: swarm → workspace on startup
		if (this.initialized) {
			const swarmDir = this.getSwarmDir();
			this.syncSwarmToWorkspace(swarmDir);
		}

		// Heartbeat auto-sync: pull every 5 minutes if initialized
		const heartbeatInterval = setInterval(() => {
			if (!this.initialized) return;
			const swarmDir = this.getSwarmDir();
			try {
				// Only if remote is configured
				const remotes = execSync('git remote', { cwd: swarmDir, encoding: 'utf8' }).trim();
				if (remotes) {
					execSync('git pull --rebase --quiet', { cwd: swarmDir, encoding: 'utf8', timeout: 15000 });
					this.refresh();
				}
			} catch {}
		}, 5 * 60 * 1000);
		context.subscriptions.push({ dispose: () => clearInterval(heartbeatInterval) });

		// Auto-refresh on swarm directory changes (debounced)
		const swarmDir = this.getSwarmDir();
		let refreshTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(swarmDir, '**/*')
			);
			const debouncedRefresh = () => {
				if (refreshTimer) clearTimeout(refreshTimer);
				refreshTimer = setTimeout(() => this.refresh(), 500);
			};
			watcher.onDidChange(debouncedRefresh);
			watcher.onDidCreate(debouncedRefresh);
			watcher.onDidDelete(debouncedRefresh);
			context.subscriptions.push(watcher);
		} catch {}
	}

	refresh(): void {
		this.detectSwarm();
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: SwarmNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: SwarmNode): SwarmNode[] {
		if (element) return [];

		if (!this.initialized) {
			return [
				new SwarmActionNode('Initialize Swarm Memory', 'clawsouls.initSwarm', 'rocket'),
			];
		}

		const items: SwarmNode[] = [];

		// Actions
		items.push(new SwarmActionNode('👤 Join as Agent', 'clawsouls.joinAgent', 'person-add'));
		items.push(new SwarmActionNode('⬆ Push', 'clawsouls.pushChanges', 'cloud-upload'));
		items.push(new SwarmActionNode('⬇ Pull', 'clawsouls.pullLatest', 'cloud-download'));
		items.push(new SwarmActionNode('🔀 Merge', 'clawsouls.mergeBranches', 'git-merge'));
		items.push(new SwarmActionNode('🔐 Encryption Keys', 'clawsouls.swarmKeys', 'key'));
		items.push(new SwarmActionNode('➕ New Branch', 'clawsouls.joinAgent', 'add'));

		// Conflicts
		if (this.hasConflicts) {
			items.push(new SwarmActionNode(`⚠️ ${this.conflictedFiles.length} Conflict(s)`, 'clawsouls.mergeBranches', 'warning'));
			for (const f of this.conflictedFiles) {
				items.push(new SwarmActionNode(`  ├ ${f}`, 'clawsouls.mergeBranches', 'diff'));
			}
		}

		// Branches
		for (const br of this.branches) {
			items.push(new SwarmBranchNode(br));
		}

		return items;
	}

	/**
	 * Swarm memory lives at {stateDir}/swarm/ — shared across all workspaces
	 * so multiple agents can access the same memory repository.
	 */
	private getSwarmDir(): string {
		const { getSwarmDir } = require('../paths');
		return getSwarmDir();
	}

	private detectSwarm(): void {
		const swarmDir = this.getSwarmDir();
		const gitDir = path.join(swarmDir, '.git');
		this.initialized = fs.existsSync(gitDir);

		if (this.initialized) {
			this.loadBranches(swarmDir);
		} else {
			this.branches = [];
		}
	}

	private loadBranches(memDir: string): void {
		try {
			const output = execSync('git branch --no-color', { cwd: memDir, encoding: 'utf8' });
			this.branches = output.split('\n')
				.map(line => line.trim())
				.filter(line => line.length > 0)
				.map(line => ({
					name: line.replace(/^\* /, ''),
					current: line.startsWith('* ')
				}));
		} catch {
			this.branches = [];
		}

		// Check for merge conflicts
		try {
			const status = execSync('git status --porcelain', { cwd: memDir, encoding: 'utf8' });
			const conflicted = status.split('\n')
				.filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
				.map(l => l.slice(3).trim());
			if (conflicted.length > 0) {
				this.hasConflicts = true;
				this.conflictedFiles = conflicted;
			} else {
				this.hasConflicts = false;
				this.conflictedFiles = [];
			}
		} catch {
			this.hasConflicts = false;
			this.conflictedFiles = [];
		}
	}

	/** Get current branch name, or null */
	private getCurrentBranch(): string | null {
		const current = this.branches.find(b => b.current);
		return current ? current.name : null;
	}

	private async initSwarm(): Promise<void> {
		const swarmDir = this.getSwarmDir();

		const repoUrl = await vscode.window.showInputBox({
			prompt: 'Git remote URL for swarm memory (or leave empty for local-only)',
			placeHolder: 'https://github.com/org/swarm-memory.git'
		});
		if (repoUrl === undefined) return;

		fs.mkdirSync(swarmDir, { recursive: true });

		try {
			if (repoUrl) {
				execSync(`git clone "${repoUrl}" .`, { cwd: swarmDir, encoding: 'utf8' });
			} else {
				execSync('git init', { cwd: swarmDir, encoding: 'utf8' });
				// Create initial soul.json so CLI works
				const ws = vscode.workspace.workspaceFolders;
				const srcSoul = ws ? path.join(ws[0].uri.fsPath, 'soul.json') : null;
				const dstSoul = path.join(swarmDir, 'soul.json');
				if (srcSoul && fs.existsSync(srcSoul)) {
					fs.copyFileSync(srcSoul, dstSoul);
				} else {
					fs.writeFileSync(dstSoul, JSON.stringify({ specVersion: "0.5", name: "swarm-memory" }, null, 2));
				}
				// Initial commit
				const sep = process.platform === 'win32' ? ';' : '&&';
				execSync(`git add -A ${sep} git commit -m "init swarm memory"`, { cwd: swarmDir, encoding: 'utf8' });
			}

			// Ask to join as agent immediately
			const agentId = await vscode.window.showInputBox({
				prompt: 'Agent name (creates agent/{name} branch)',
				placeHolder: 'e.g. brad, alice, my-agent',
				value: 'main'
			});
			if (agentId) {
				const agentBranch = agentId.startsWith('agent/') ? agentId : `agent/${agentId}`;
				try {
					execSync(`git checkout -b "${agentBranch}"`, { cwd: swarmDir, encoding: 'utf8' });
				} catch {
					// Branch may already exist
					execSync(`git checkout "${agentBranch}"`, { cwd: swarmDir, encoding: 'utf8' });
				}
				vscode.window.showInformationMessage(`✅ Swarm Memory initialized + joined as "${agentBranch}"`);
			} else {
				vscode.window.showInformationMessage(`✅ Swarm Memory initialized at: ${swarmDir}`);
			}
			this.refresh();
			try { await vscode.commands.executeCommand('clawsouls.refreshStatusBar'); } catch {}
		} catch (err: any) {
			vscode.window.showErrorMessage(`Swarm Memory init failed: ${err.message}`);
		}
	}

	private async joinAgent(): Promise<void> {
		const swarmDir = this.getSwarmDir();
		if (!this.initialized) {
			vscode.window.showWarningMessage('Initialize swarm first.');
			return;
		}

		const input = await vscode.window.showInputBox({
			prompt: 'Agent name (e.g. brad, alice)',
			placeHolder: 'e.g. brad, alice, my-agent'
		});
		if (!input) return;

		// Auto-add agent/ prefix
		const branchName = input.startsWith('agent/') ? input : `agent/${input}`;

		try {
			try {
				execSync(`git checkout -b "${branchName}"`, { cwd: swarmDir, encoding: 'utf8' });
			} catch {
				// Branch already exists — switch to it
				execSync(`git checkout "${branchName}"`, { cwd: swarmDir, encoding: 'utf8' });
			}
			// Write CLI-compatible swarm config
			const configDir = require('path').join(swarmDir, '.soulscan');
			require('fs').mkdirSync(configDir, { recursive: true });
			const configPath = require('path').join(swarmDir, '.soulscan', 'swarm.json');
			const config = { agentBranch: branchName, initialized: true };
			require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2));

			// Ensure at least one commit exists (required for push)
			try {
				execSync('git log -1', { cwd: swarmDir, encoding: 'utf8' });
			} catch {
				// No commits yet — create initial commit
				const readmePath = require('path').join(swarmDir, 'README.md');
				require('fs').writeFileSync(readmePath, `# Swarm Memory\n\nAgent: ${branchName}\n`);
			}
			execSync('git add -A && git commit -m "init: agent joined" --allow-empty', { cwd: swarmDir, encoding: 'utf8' });
			vscode.window.showInformationMessage(`✅ Joined as "${branchName}".`);
			this.refresh();
			try { await vscode.commands.executeCommand('clawsouls.refreshStatusBar'); } catch {}
		} catch (err: any) {
			vscode.window.showErrorMessage(`Join failed: ${err.message}`);
		}
	}

	private async mergeBranches(): Promise<void> {
		const swarmDir = this.getSwarmDir();
		if (!this.initialized) return;

		const otherBranches = this.branches.filter(b => !b.current).map(b => b.name);
		if (otherBranches.length === 0) {
			vscode.window.showInformationMessage('No other branches to merge.');
			return;
		}

		const picked = await vscode.window.showQuickPick(otherBranches, {
			placeHolder: 'Select branch to merge into current'
		});
		if (!picked) return;

		const strategy = await vscode.window.showQuickPick(
			[
				{ label: 'Git merge (default)', value: 'git' },
				{ label: 'LLM semantic merge (Ollama)', value: 'llm' }
			],
			{ placeHolder: 'Select merge strategy' }
		);
		if (!strategy) return;

		if (strategy.value === 'llm') {
			this.runCli(`swarm merge "${picked}" --strategy llm`);
		} else {
			try {
				execSync(`git merge "${picked}"`, { cwd: swarmDir, encoding: 'utf8' });
				vscode.window.showInformationMessage(`✅ Merged "${picked}" into current branch.`);
				this.refresh();
			} catch (err: any) {
				vscode.window.showWarningMessage(`Merge conflict — resolve manually or try LLM merge.\n${err.message}`);
			}
		}
	}

	private async switchBranch(node: SwarmBranchNode): Promise<void> {
		const swarmDir = this.getSwarmDir();
		const out = globalThis.__soulclawOutput;

		try {
			out?.appendLine(`[Swarm] switchBranch: checking out "${node.branch.name}" in ${swarmDir}`);
			// Stash any local changes (e.g. swarm.json) before switching
			try {
				execSync('git stash --include-untracked', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			} catch {}
			const result = execSync(`git checkout "${node.branch.name}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			out?.appendLine(`[Swarm] checkout result: ${result.trim()}`);
			// Pop stash if any
			try {
				execSync('git stash pop', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			} catch {}

			// Verify checkout worked
			const head = execSync('git rev-parse --abbrev-ref HEAD', { cwd: swarmDir, encoding: 'utf8' }).trim();
			out?.appendLine(`[Swarm] HEAD after checkout: ${head}`);

			// Update swarm config for CLI compatibility + commit so checkout stays clean
			const configPath = require('path').join(swarmDir, '.soulscan', 'swarm.json');
			try {
				const config = JSON.parse(require('fs').readFileSync(configPath, 'utf8'));
				config.agentBranch = node.branch.name;
				require('fs').writeFileSync(configPath, JSON.stringify(config, null, 2));
				execSync('git add .soulscan/swarm.json && git commit -m "switch agent branch" --no-verify', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			} catch {}

			// Force reload branches before firing tree update
			this.loadBranches(swarmDir);
			out?.appendLine(`[Swarm] branches after reload: ${JSON.stringify(this.branches)}`);
			
			// Fire tree update immediately + delayed (belt and suspenders)
			this._onDidChangeTreeData.fire(undefined);
			setTimeout(() => {
				out?.appendLine(`[Swarm] delayed fire — branches: ${JSON.stringify(this.branches)}`);
				this._onDidChangeTreeData.fire(undefined);
			}, 300);

			// Sync swarm memory → workspace
			this.syncSwarmToWorkspace(swarmDir, out);

			vscode.window.showInformationMessage(`Switched to "${node.branch.name}". Memory synced.`);
			// Update status bar agent name
			try { await vscode.commands.executeCommand('clawsouls.refreshStatusBar'); } catch {}
		} catch (err: any) {
			out?.appendLine(`[Swarm] switchBranch error: ${err.message}`);
			vscode.window.showErrorMessage(`Switch failed: ${err.message}`);
		}
	}

	private async pullWithSync(): Promise<void> {
		const out = globalThis.__soulclawOutput;
		await this.runCli('swarm pull');
		const swarmDir = this.getSwarmDir();
		this.syncSwarmToWorkspace(swarmDir, out);
	}

	private async pushWithSync(): Promise<void> {
		const out = (globalThis as any).__soulclawOutput;
		const swarmDir = this.getSwarmDir();
		if (!this.initialized) {
			vscode.window.showWarningMessage('Initialize swarm first.');
			return;
		}

		this.syncWorkspaceToSwarm(swarmDir, out);

		// Encrypt memory files if age recipient is configured
		try {
			const recipientsFile = path.join(swarmDir, '.soulscan', 'age-recipients.txt');
			if (fs.existsSync(recipientsFile)) {
				const recipients = fs.readFileSync(recipientsFile, 'utf8').trim();
				if (recipients) {
					const memFiles: string[] = [];
					const memoryMd = path.join(swarmDir, 'MEMORY.md');
					if (fs.existsSync(memoryMd)) memFiles.push(memoryMd);
					const memDir = path.join(swarmDir, 'memory');
					if (fs.existsSync(memDir)) {
						for (const f of fs.readdirSync(memDir)) {
							if (f.endsWith('.md')) memFiles.push(path.join(memDir, f));
						}
					}
					for (const f of memFiles) {
						try {
							execSync(`age -r "${recipients.split('\\n')[0]}" -o "${f}.age" "${f}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
						} catch { /* age not installed — skip */ }
					}
					if (memFiles.length > 0) out?.appendLine(`[Swarm] encrypted ${memFiles.length} memory file(s)`);
				}
			}
		} catch { /* encryption optional */ }

		try {
			// Stage all changes
			execSync('git add -A', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			
			// Check if there are changes to commit
			try {
				execSync('git diff --cached --quiet', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
				// No changes — just push any unpushed commits
			} catch {
				// Has staged changes — commit them
				const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
				execSync(`git commit -m "swarm sync ${now}" --no-verify`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
				out?.appendLine('[Swarm] committed changes');
			}

			// Push to remote
			const branch = this.getCurrentBranch() || 'agent/main';
			execSync(`git push origin "${branch}" 2>&1`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			vscode.window.showInformationMessage(`✅ Pushed to ${branch}`);
			out?.appendLine(`[Swarm] pushed to origin/${branch}`);
			this.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`Push failed: ${err.message}`);
			out?.appendLine(`[Swarm] push error: ${err.message}`);
		}
	}

	/** Sync swarm branch memory files → workspace (overwrite) */
	private syncSwarmToWorkspace(swarmDir: string, out?: any): void {
		const { getWorkspaceDir } = require('../paths');
		const workspaceDir = getWorkspaceDir();

		// Delete existing memory from workspace
		const wsMemory = path.join(workspaceDir, 'MEMORY.md');
		const wsMemoryDir = path.join(workspaceDir, 'memory');
		if (fs.existsSync(wsMemory)) fs.unlinkSync(wsMemory);
		if (fs.existsSync(wsMemoryDir)) fs.rmSync(wsMemoryDir, { recursive: true, force: true });

		// Copy MEMORY.md from swarm
		const swarmMemory = path.join(swarmDir, 'MEMORY.md');
		if (fs.existsSync(swarmMemory)) {
			fs.copyFileSync(swarmMemory, wsMemory);
			out?.appendLine(`[Swarm] synced MEMORY.md → workspace`);
		}

		// Copy memory/ directory from swarm
		const swarmMemoryDir = path.join(swarmDir, 'memory');
		if (fs.existsSync(swarmMemoryDir)) {
			fs.mkdirSync(wsMemoryDir, { recursive: true });
			for (const entry of fs.readdirSync(swarmMemoryDir)) {
				const src = path.join(swarmMemoryDir, entry);
				if (fs.statSync(src).isFile()) {
					fs.copyFileSync(src, path.join(wsMemoryDir, entry));
				}
			}
			out?.appendLine(`[Swarm] synced memory/ → workspace`);
		}
	}

	/** Sync workspace memory files → swarm branch (before push) */
	private syncWorkspaceToSwarm(swarmDir: string, out?: any): void {
		const { getWorkspaceDir } = require('../paths');
		const internalWorkspace = getWorkspaceDir();

		// Collect source dirs: internal workspace + VSCode workspace
		const sourceDirs: string[] = [internalWorkspace];
		const vsWorkspaces = vscode.workspace.workspaceFolders;
		if (vsWorkspaces && vsWorkspaces.length > 0) {
			const vsDir = vsWorkspaces[0].uri.fsPath;
			if (vsDir !== internalWorkspace) sourceDirs.push(vsDir);
		}

		for (const workspaceDir of sourceDirs) {
			// Copy MEMORY.md to swarm
			const wsMemory = path.join(workspaceDir, 'MEMORY.md');
			const swarmMemory = path.join(swarmDir, 'MEMORY.md');
			if (fs.existsSync(wsMemory)) {
				fs.copyFileSync(wsMemory, swarmMemory);
				out?.appendLine(`[Swarm] copied MEMORY.md from ${workspaceDir}`);
			}

			// Copy memory/ to swarm
			const wsMemoryDir = path.join(workspaceDir, 'memory');
			const swarmMemoryDir = path.join(swarmDir, 'memory');
			if (fs.existsSync(wsMemoryDir)) {
				fs.mkdirSync(swarmMemoryDir, { recursive: true });
				for (const entry of fs.readdirSync(wsMemoryDir)) {
					const src = path.join(wsMemoryDir, entry);
					if (fs.statSync(src).isFile()) {
						fs.copyFileSync(src, path.join(swarmMemoryDir, entry));
					}
				}
				out?.appendLine(`[Swarm] copied memory/ from ${workspaceDir}`);
			}
		}

		// Stage and commit
		try {
			execSync('git add MEMORY.md memory/ 2>/dev/null; git diff --cached --quiet || git commit -m "sync workspace memory" --no-verify', 
				{ cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			out?.appendLine(`[Swarm] synced workspace → swarm`);
		} catch {}
	}

	private async deleteBranch(node: SwarmBranchNode): Promise<void> {
		if (node.branch.current) {
			vscode.window.showWarningMessage('Cannot delete the current branch.');
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`Delete branch "${node.branch.name}"? This cannot be undone.`,
			{ modal: true },
			'Delete'
		);
		if (confirm !== 'Delete') return;

		const swarmDir = this.getSwarmDir();
		try {
			execSync(`git branch -D "${node.branch.name}"`, { cwd: swarmDir, encoding: 'utf8' });
			vscode.window.showInformationMessage(`Branch "${node.branch.name}" deleted.`);
			this.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to delete branch: ${err.message}`);
		}
	}

	private async manageKeys(): Promise<void> {
		const action = await vscode.window.showQuickPick(
			[
				{ label: '🔑 Init keys', value: 'swarm keys init' },
				{ label: '👁 Show public key', value: 'swarm keys show' },
				{ label: '➕ Add recipient', value: 'swarm keys add' },
				{ label: '📋 List recipients', value: 'swarm keys list' },
				{ label: '🔄 Rotate keys', value: 'swarm keys rotate' },
			],
			{ placeHolder: 'Select encryption key action' }
		);
		if (!action) return;

		if (action.value === 'swarm keys add') {
			const key = await vscode.window.showInputBox({ prompt: 'Enter age public key (age1...)' });
			if (!key) return;
			this.runCli(`${action.value} "${key}"`);
		} else {
			this.runCli(action.value);
		}
	}

	private async runCli(command: string): Promise<void> {
		const swarmDir = this.getSwarmDir();
		if (!this.initialized) {
			vscode.window.showWarningMessage('Initialize swarm first.');
			return;
		}

		// Warn if not on agent/* branch for push/pull
		const currentBranch = this.getCurrentBranch();
		if ((command === 'swarm push' || command === 'swarm pull') && currentBranch && !currentBranch.startsWith('agent/')) {
			const proceed = await vscode.window.showWarningMessage(
				`Current branch "${currentBranch}" is not an agent branch. Push/Pull expects "agent/*". Continue anyway?`,
				'Continue', 'Cancel'
			);
			if (proceed !== 'Continue') return;
		}

		// For pull and merge, also sync to workspace + restart engine
		const needsSync = command === 'swarm pull' || command.startsWith('swarm merge');

		const terminal = vscode.window.createTerminal('ClawSouls Swarm');
		terminal.show();
		const sep = process.platform === 'win32' ? ';' : '&&';

		if (needsSync) {
			// Run CLI command, then sync to workspace
			terminal.sendText(`cd "${swarmDir}" ${sep} npx clawsouls ${command} ${sep} npx clawsouls swarm sync`);

			// Restart engine after a short delay to pick up new files
			setTimeout(async () => {
				try {
					await vscode.commands.executeCommand('clawsouls.restartGateway');
				} catch {
					// Non-fatal — engine restart command may not be registered
				}
				this.refresh();
			}, 5000);
		} else {
			terminal.sendText(`cd "${swarmDir}" ${sep} npx clawsouls ${command}`);
		}
	}
}

class SwarmBranchNode extends vscode.TreeItem {
	constructor(public readonly branch: SwarmBranch) {
		super(
			branch.name,
			vscode.TreeItemCollapsibleState.None
		);
		this.description = branch.current ? '● current' : '';
		this.iconPath = new vscode.ThemeIcon(branch.current ? 'git-branch' : 'git-branch');
		this.contextValue = branch.current ? 'swarmBranchCurrent' : 'swarmBranch';

		if (!branch.current) {
			this.command = {
				command: 'clawsouls.swarm.switchBranch',
				title: 'Switch Branch',
				arguments: [this]
			};
		}
	}
}

class SwarmActionNode extends vscode.TreeItem {
	constructor(label: string, commandId: string, icon: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(icon);
		this.command = {
			command: commandId,
			title: label
		};
	}
}
