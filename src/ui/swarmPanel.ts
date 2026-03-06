import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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

	private getWorkspaceRoot(): string | null {
		const ws = vscode.workspace.workspaceFolders;
		return ws && ws.length > 0 ? ws[0].uri.fsPath : null;
	}

	private getMemoryDir(): string | null {
		const root = this.getWorkspaceRoot();
		if (!root) return null;
		const memDir = path.join(root, 'memory');
		return fs.existsSync(memDir) ? memDir : null;
	}

	private detectSwarm(): void {
		const root = this.getWorkspaceRoot();
		if (!root) {
			this.initialized = false;
			this.branches = [];
			return;
		}

		// Check if memory/ dir has .git (swarm initialized)
		const memDir = path.join(root, 'memory');
		const gitDir = path.join(memDir, '.git');
		this.initialized = fs.existsSync(gitDir);

		if (this.initialized) {
			this.loadBranches(memDir);
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

	private async initSwarm(): Promise<void> {
		const root = this.getWorkspaceRoot();
		if (!root) {
			vscode.window.showWarningMessage('Open a workspace folder first.');
			return;
		}

		const repoUrl = await vscode.window.showInputBox({
			prompt: 'Git remote URL for swarm memory (or leave empty for local-only)',
			placeHolder: 'https://github.com/org/swarm-memory.git'
		});
		if (repoUrl === undefined) return;

		const memDir = path.join(root, 'memory');
		fs.mkdirSync(memDir, { recursive: true });

		try {
			if (repoUrl) {
				execSync(`git clone "${repoUrl}" .`, { cwd: memDir, encoding: 'utf8' });
			} else {
				execSync('git init', { cwd: memDir, encoding: 'utf8' });
			}
			vscode.window.showInformationMessage('✅ Swarm Memory initialized.');
			this.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`Swarm Memory init failed: ${err.message}`);
		}
	}

	private async joinAgent(): Promise<void> {
		const root = this.getWorkspaceRoot();
		const memDir = root ? path.join(root, 'memory') : null;
		if (!memDir || !this.initialized) {
			vscode.window.showWarningMessage('Initialize swarm first.');
			return;
		}

		const branchName = await vscode.window.showInputBox({
			prompt: 'Agent branch name',
			placeHolder: 'e.g. agent/brad, agent/alice'
		});
		if (!branchName) return;

		try {
			execSync(`git checkout -b "${branchName}"`, { cwd: memDir, encoding: 'utf8' });
			vscode.window.showInformationMessage(`✅ Joined as "${branchName}".`);
			this.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`Join failed: ${err.message}`);
		}
	}

	private async mergeBranches(): Promise<void> {
		const root = this.getWorkspaceRoot();
		const memDir = root ? path.join(root, 'memory') : null;
		if (!memDir || !this.initialized) return;

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
				execSync(`git merge "${picked}"`, { cwd: memDir, encoding: 'utf8' });
				vscode.window.showInformationMessage(`✅ Merged "${picked}" into current branch.`);
				this.refresh();
			} catch (err: any) {
				vscode.window.showWarningMessage(`Merge conflict — resolve manually or try LLM merge.\n${err.message}`);
			}
		}
	}

	private async switchBranch(node: SwarmBranchNode): Promise<void> {
		const root = this.getWorkspaceRoot();
		const memDir = root ? path.join(root, 'memory') : null;
		if (!memDir) return;

		try {
			execSync(`git checkout "${node.branch.name}"`, { cwd: memDir, encoding: 'utf8' });
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
		const root = this.getWorkspaceRoot();
		const memDir = root ? path.join(root, 'memory') : null;
		if (!memDir || !this.initialized) {
			vscode.window.showWarningMessage('Initialize swarm first.');
			return;
		}

		const terminal = vscode.window.createTerminal('ClawSouls Swarm');
		terminal.show();
		const sep = process.platform === 'win32' ? ';' : '&&';
		terminal.sendText(`cd "${memDir}" ${sep} npx clawsouls ${command}`);
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
