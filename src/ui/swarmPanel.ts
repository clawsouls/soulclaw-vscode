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

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand('clawsouls.initSwarm', () => this.initSwarm()),
			vscode.commands.registerCommand('clawsouls.swarmKeys', () => this.manageKeys()),
			vscode.commands.registerCommand('clawsouls.pushChanges', () => this.runCli('swarm push')),
			vscode.commands.registerCommand('clawsouls.pullLatest', () => this.runCli('swarm pull')),
			vscode.commands.registerCommand('clawsouls.mergeBranches', () => this.mergeBranches()),
			vscode.commands.registerCommand('clawsouls.joinAgent', () => this.joinAgent()),
			vscode.commands.registerCommand('clawsouls.swarm.switchBranch', (node: SwarmBranchNode) => this.switchBranch(node))
		);

		this.detectSwarm();
	}

	refresh(): void {
		this.detectSwarm();
		this._onDidChangeTreeData.fire();
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

		// Branches
		for (const br of this.branches) {
			items.push(new SwarmBranchNode(br));
		}

		return items;
	}

	/**
	 * Swarm memory lives at ~/.openclaw/swarm/ — shared across all workspaces
	 * so multiple agents can access the same memory repository.
	 */
	private getSwarmDir(): string {
		return path.join(os.homedir(), '.openclaw', 'swarm');
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
			vscode.window.showInformationMessage(`✅ Joined as "${branchName}".`);
			this.refresh();
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

		try {
			execSync(`git checkout "${node.branch.name}"`, { cwd: swarmDir, encoding: 'utf8' });
			vscode.window.showInformationMessage(`Switched to "${node.branch.name}".`);
			this.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`Switch failed: ${err.message}`);
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

		const terminal = vscode.window.createTerminal('ClawSouls Swarm');
		terminal.show();
		const sep = process.platform === 'win32' ? ';' : '&&';
		terminal.sendText(`cd "${swarmDir}" ${sep} npx clawsouls ${command}`);
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
		this.contextValue = 'swarmBranch';

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
