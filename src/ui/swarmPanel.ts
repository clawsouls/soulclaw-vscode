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

		// Conflicts / merge in progress
		if (this.hasConflicts || this.mergeInProgress) {
			items.push(new SwarmActionNode(`⚠️ ${this.conflictedFiles.length} Conflict(s) — Click to resolve`, 'clawsouls.mergeBranches', 'warning'));
			for (const f of this.conflictedFiles) {
				items.push(new SwarmActionNode(`  ├ ${f}`, 'clawsouls.mergeBranches', 'diff'));
			}
		}

		// Branches
		for (const br of this.branches) {
			items.push(new SwarmBranchNode(br));
		}

		// New Branch at the end
		items.push(new SwarmActionNode('➕ New Branch', 'clawsouls.joinAgent', 'add'));

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
				// Ensure main branch exists (empty repo case)
				const branches = execSync('git branch -a', { cwd: swarmDir, encoding: 'utf8' });
				if (!branches.includes('main') && !branches.includes('master')) {
					// Empty repo or no main — create initial main
					fs.writeFileSync(path.join(swarmDir, 'README.md'), '# Swarm Memory\n');
					const sep = process.platform === 'win32' ? ';' : '&&';
					execSync(`git checkout -b main ${sep} git add -A ${sep} git commit -m "init: swarm memory" ${sep} git push origin main`, { cwd: swarmDir, encoding: 'utf8' });
				}
			} else {
				execSync('git init -b main', { cwd: swarmDir, encoding: 'utf8' });
				// Create initial soul.json so CLI works
				const ws = vscode.workspace.workspaceFolders;
				const srcSoul = ws ? path.join(ws[0].uri.fsPath, 'soul.json') : null;
				const dstSoul = path.join(swarmDir, 'soul.json');
				if (srcSoul && fs.existsSync(srcSoul)) {
					fs.copyFileSync(srcSoul, dstSoul);
				} else {
					fs.writeFileSync(dstSoul, JSON.stringify({ specVersion: "0.5", name: "swarm-memory" }, null, 2));
				}
				// Initial commit on main
				const sep = process.platform === 'win32' ? ';' : '&&';
				execSync(`git add -A ${sep} git commit -m "init: swarm memory"`, { cwd: swarmDir, encoding: 'utf8' });
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

	private mergeInProgress = false;
	private mergeBranchName = '';

	private async mergeBranches(): Promise<void> {
		const swarmDir = this.getSwarmDir();
		const out = (globalThis as any).__soulclawOutput;
		if (!this.initialized) return;

		// If merge in progress, show resolve options
		if (this.hasConflicts || this.mergeInProgress) {
			return this.handleMergeConflicts(swarmDir, out);
		}

		const otherBranches = this.branches.filter(b => !b.current).map(b => b.name);
		if (otherBranches.length === 0) {
			vscode.window.showInformationMessage('No other branches to merge.');
			return;
		}

		const picked = await vscode.window.showQuickPick(otherBranches, {
			placeHolder: 'Select branch to merge into current'
		});
		if (!picked) return;

		this.mergeBranchName = picked;

		try {
			execSync(`git merge "${picked}" --no-commit --allow-unrelated-histories`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			// Clean merge — commit it
			execSync(`git commit -m "swarm merge: ${picked}" --no-verify`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			vscode.window.showInformationMessage(`✅ Merged "${picked}" (clean)`);
			// Push
			const branch = this.getCurrentBranch();
			if (branch) {
				try { execSync(`git push origin "${branch}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch {}
			}
			this.refresh();
		} catch {
			// Auto-resolve non-content files before showing conflict UI
			this.autoResolveNonContent(swarmDir, out);
			this.refresh();
			if (this.hasConflicts) {
				this.mergeInProgress = true;
				this.refresh();
				await this.handleMergeConflicts(swarmDir, out);
			} else {
				// Merge failed for other reason
				try { execSync('git merge --abort', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch {}
				vscode.window.showErrorMessage('Merge failed.');
			}
		}
	}

	/** Auto-resolve config/binary files: keep "ours" for .soulscan/*, skip .age files */
	private autoResolveNonContent(swarmDir: string, out?: any): void {
		try {
			const status = execSync('git status --porcelain', { cwd: swarmDir, encoding: 'utf8' });
			const conflicted = status.split('\n')
				.filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
				.map(l => l.slice(3).trim());
			
			for (const f of conflicted) {
				// Auto-resolve: config files → keep ours, binary .age → keep ours
				if (f.includes('.soulscan/') || f.endsWith('.age') || f === 'soul.json' || f === 'README.md') {
					try {
						execSync(`git checkout --ours "${f}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
						execSync(`git add "${f}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
						out?.appendLine(`[Swarm] auto-resolved (keep ours): ${f}`);
					} catch {}
				}
			}
		} catch {}
	}

	private async handleMergeConflicts(swarmDir: string, out?: any): Promise<void> {
		// If no actual conflicts remain, auto-complete
		if (this.conflictedFiles.length === 0 && this.mergeInProgress) {
			try {
				execSync('git add -A', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
				execSync(`git commit -m "swarm merge: ${this.mergeBranchName} (resolved)" --no-verify`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
				const branch = this.getCurrentBranch();
				if (branch) {
					try { execSync(`git push origin "${branch}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch {}
				}
				this.mergeInProgress = false;
				vscode.window.showInformationMessage('✅ Merge complete!');
				this.refresh();
				return;
			} catch {}
		}

		const action = await vscode.window.showQuickPick(
			[
				{ label: '🤖 LLM Resolve', description: 'Auto-resolve with Ollama', value: 'llm' },
				{ label: '✏️ Open in Editor', description: 'Resolve manually in VSCode', value: 'editor' },
				{ label: '✅ Complete Merge', description: 'All conflicts resolved — commit & push', value: 'complete' },
				{ label: '↩️ Abort', description: 'Cancel merge', value: 'abort' },
			],
			{ placeHolder: `${this.conflictedFiles.length} conflict(s) — choose resolution` }
		);
		if (!action) return;

		if (action.value === 'abort') {
			try { execSync('git merge --abort', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch {}
			this.mergeInProgress = false;
			vscode.window.showInformationMessage('Merge aborted.');
			this.refresh();

		} else if (action.value === 'editor') {
			// Open conflicted files in VSCode editor
			for (const f of this.conflictedFiles) {
				const filePath = path.join(swarmDir, f);
				if (fs.existsSync(filePath)) {
					const doc = await vscode.workspace.openTextDocument(filePath);
					await vscode.window.showTextDocument(doc, { preview: false });
				}
			}
			vscode.window.showInformationMessage(
				`Opened ${this.conflictedFiles.length} file(s). Edit to resolve, then click "✅ Complete Merge" in Swarm panel.`
			);

		} else if (action.value === 'complete') {
			try {
				execSync('git add -A', { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
				execSync(`git commit -m "swarm merge: ${this.mergeBranchName} (resolved)" --no-verify`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
				const branch = this.getCurrentBranch();
				if (branch) {
					try { execSync(`git push origin "${branch}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch {}
				}
				this.mergeInProgress = false;
				vscode.window.showInformationMessage(`✅ Merge complete!`);
				out?.appendLine('[Swarm] merge completed');
				this.refresh();
			} catch (err: any) {
				vscode.window.showErrorMessage(`Complete merge failed: ${err.message}`);
			}

		} else if (action.value === 'llm') {
			await this.llmResolveConflicts(swarmDir, out);
		}
	}

	private async llmResolveConflicts(swarmDir: string, out?: any): Promise<void> {
		// Check Ollama availability
		let ollamaUrl = 'http://localhost:11434';
		try {
			execSync(`curl -s ${ollamaUrl}/api/tags`, { encoding: 'utf8', timeout: 3000 });
		} catch {
			vscode.window.showErrorMessage('Ollama not available. Start with: ollama serve');
			return;
		}

		// Get models
		let models: string[] = [];
		try {
			const resp = JSON.parse(execSync(`curl -s ${ollamaUrl}/api/tags`, { encoding: 'utf8' }));
			models = (resp.models || []).map((m: any) => m.name).filter((n: string) => !n.includes('embed'));
		} catch {}

		if (models.length === 0) {
			vscode.window.showErrorMessage('No Ollama models found. Run: ollama pull qwen3:8b');
			return;
		}

		const model = models.length === 1 ? models[0] : await vscode.window.showQuickPick(models, { placeHolder: 'Select LLM model for merge' });
		if (!model) return;

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'LLM Merge', cancellable: false },
			async (progress) => {
				let resolved = 0;
				const contentFiles = this.conflictedFiles.filter(f => 
					!f.endsWith('.age') && !f.includes('.soulscan/') && f !== 'soul.json' && f !== 'README.md'
				);
				// Auto-resolve remaining non-content files
				for (const f of this.conflictedFiles.filter(ff => !contentFiles.includes(ff))) {
					try {
						execSync(`git checkout --ours "${f}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
						execSync(`git add "${f}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
						resolved++;
					} catch {}
				}
				for (const f of contentFiles) {
					progress.report({ message: `Resolving ${f}...`, increment: 100 / Math.max(contentFiles.length, 1) });

					const filePath = path.join(swarmDir, f);
					const content = fs.readFileSync(filePath, 'utf8');

					// Extract ours/theirs from conflict markers
					const ours: string[] = [];
					const theirs: string[] = [];
					let inOurs = false, inTheirs = false;
					for (const line of content.split('\n')) {
						if (line.startsWith('<<<<<<<')) { inOurs = true; continue; }
						if (line.startsWith('=======')) { inOurs = false; inTheirs = true; continue; }
						if (line.startsWith('>>>>>>>')) { inTheirs = false; continue; }
						if (inOurs) ours.push(line);
						else if (inTheirs) theirs.push(line);
					}

					const prompt = `You are merging two versions of a file called "${f}" from different AI agents.

VERSION A (current branch):
${ours.join('\n')}

VERSION B (incoming branch):
${theirs.join('\n')}

Merge these two versions intelligently:
- Keep ALL unique information from both
- Remove duplicates
- Maintain consistent formatting
- For memory files: combine all entries chronologically
- Output ONLY the merged content, no explanations`;

					try {
						// SECURITY: pass the request body through curl's stdin via
						// `--data-binary @-` instead of interpolating JSON into the
						// shell command. Raw interpolation would let stray `'` chars
						// in conflict markers break out of the single-quoted string
						// and inject shell commands.
						const body = JSON.stringify({ model, prompt, stream: false });
						const resp = JSON.parse(execSync(
							`curl -s ${ollamaUrl}/api/generate --data-binary @-`,
							{ input: body, encoding: 'utf8', timeout: 60000 }
						));
						const merged = resp.response?.trim();
						if (merged) {
							// Replace conflict markers with merged content
							const lines = content.split('\n');
							const result: string[] = [];
							let skip = false;
							for (const line of lines) {
								if (line.startsWith('<<<<<<<')) { skip = true; result.push(merged); continue; }
								if (line.startsWith('>>>>>>>')) { skip = false; continue; }
								if (!skip) result.push(line);
							}
							fs.writeFileSync(filePath, result.join('\n'));
							execSync(`git add "${f}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
							resolved++;
							out?.appendLine(`[Swarm] LLM resolved: ${f}`);
						}
					} catch (err: any) {
						out?.appendLine(`[Swarm] LLM failed for ${f}: ${err.message}`);
					}
				}

				if (resolved === this.conflictedFiles.length) {
					// All resolved — auto-complete
					try {
						execSync(`git commit -m "swarm merge: ${this.mergeBranchName} (LLM resolved)" --no-verify`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
						const branch = this.getCurrentBranch();
						if (branch) {
							try { execSync(`git push origin "${branch}"`, { cwd: swarmDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch {}
						}
						this.mergeInProgress = false;
						vscode.window.showInformationMessage(`✅ LLM resolved ${resolved} conflict(s) and merged!`);
					} catch {}
				} else {
					vscode.window.showWarningMessage(`LLM resolved ${resolved}/${this.conflictedFiles.length}. Remaining need manual resolution.`);
				}
				this.refresh();
			}
		);
	}

	private async switchBranch(node: SwarmBranchNode): Promise<void> {
		const swarmDir = this.getSwarmDir();
		const out = (globalThis as any).__soulclawOutput;

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
		const out = (globalThis as any).__soulclawOutput;
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
			const recipientsFile = path.join(require('os').homedir(), '.clawsouls', 'keys', 'recipients.txt');
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
					// Resolve the `age` binary before attempting any encryption —
					// common install locations are ~/.local/bin (pipx), brew
					// prefixes on macOS (/opt/homebrew/bin, /usr/local/bin), and
					// PATH. First match wins; falling back to bare "age" relies on
					// PATH resolution and silently fails when age isn't installed.
					const ageCandidates = [
						path.join(require('os').homedir(), '.local', 'bin', 'age'),
						'/opt/homebrew/bin/age',
						'/usr/local/bin/age',
					];
					let ageBin = ageCandidates.find(p => fs.existsSync(p));
					if (!ageBin) {
						try {
							ageBin = execSync('command -v age', { encoding: 'utf8' }).trim() || undefined;
						} catch { /* age not on PATH */ }
					}
					if (!ageBin) {
						out?.appendLine('[Swarm] age binary not found — skipping encryption (install with `brew install age`)');
					} else {
						for (const f of memFiles) {
							try {
								execSync(`"${ageBin}" -r "${recipients.split('\\n')[0]}" -o "${f}.age" "${f}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
							} catch { /* per-file age failure — skip and continue */ }
						}
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

			// Push to remote — require an actual current branch. A silent
			// fallback to 'agent/main' could clobber another agent's memory
			// if branch detection fails for any reason.
			const branch = this.getCurrentBranch();
			if (!branch) {
				throw new Error('Could not determine current agent branch. Run "Swarm: Join as Agent" first.');
			}
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
