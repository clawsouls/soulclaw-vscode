import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';

const API_BASE = 'https://clawsouls.ai/api/v1';

interface SoulSummary {
	name: string;
	owner: string;
	fullName: string;
	displayName: string;
	description: string;
	category: string;
	tags: string[];
	downloads: number;
	scanScore: number | null;
	scanStatus: string;
	version: string;
	license: string;
	files: Record<string, string>;
}

function apiGet(urlPath: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const url = `${API_BASE}${urlPath}`;
		https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
			let data = '';
			res.on('data', (chunk: string) => data += chunk);
			res.on('end', () => {
				try { resolve(JSON.parse(data)); }
				catch { reject(new Error(`Invalid JSON from ${url}`)); }
			});
		}).on('error', reject);
	});
}

type TreeNode = CategoryNode | RemoteSoulNode | LocalSoulFile;

export class SoulExplorerProvider implements vscode.TreeDataProvider<TreeNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private remoteCache: SoulSummary[] = [];
	private searchQuery = '';
	private viewMode: 'browse' | 'local' = 'browse';

	constructor(private context: vscode.ExtensionContext) {
		// Watch local soul files
		const watcher = vscode.workspace.createFileSystemWatcher('**/{soul.json,SOUL.md,AGENTS.md,MEMORY.md,IDENTITY.md}');
		watcher.onDidChange(() => this.refresh());
		watcher.onDidCreate(() => this.refresh());
		watcher.onDidDelete(() => this.refresh());
		context.subscriptions.push(watcher);

		// Register soul explorer commands
		context.subscriptions.push(
			vscode.commands.registerCommand('clawsouls.soulExplorer.search', () => this.searchSouls()),
			vscode.commands.registerCommand('clawsouls.soulExplorer.toggleView', () => this.toggleView()),
			vscode.commands.registerCommand('clawsouls.soulExplorer.apply', (node: RemoteSoulNode) => this.applySoul(node)),
			vscode.commands.registerCommand('clawsouls.soulExplorer.preview', (node: RemoteSoulNode) => this.previewSoul(node)),
			vscode.commands.registerCommand('clawsouls.refresh', () => this.refresh()),
			vscode.commands.registerCommand('clawsouls.soulExplorer.publish', () => this.publishSoul()),
			vscode.commands.registerCommand('clawsouls.soulExplorer.diff', (node: RemoteSoulNode) => this.diffSoul(node)),
			vscode.commands.registerCommand('clawsouls.soulExplorer.bumpVersion', () => this.bumpVersion())
		);

		// Load remote souls on init
		this.loadRemoteSouls();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TreeNode): Promise<TreeNode[]> {
		if (!element) {
			return this.getRootChildren();
		}
		if (element instanceof CategoryNode) {
			return element.children;
		}
		return [];
	}

	private async getRootChildren(): Promise<TreeNode[]> {
		if (this.viewMode === 'local') {
			return this.getLocalFiles();
		}

		// Browse mode — group by category
		let souls = this.remoteCache;
		if (this.searchQuery) {
			const q = this.searchQuery.toLowerCase();
			souls = souls.filter(s =>
				s.displayName.toLowerCase().includes(q) ||
				s.description.toLowerCase().includes(q) ||
				s.tags.some(t => t.toLowerCase().includes(q)) ||
				s.fullName.toLowerCase().includes(q)
			);
		}

		if (souls.length === 0) {
			if (this.remoteCache.length === 0) {
				return [new MessageNode('Loading souls...')];
			}
			return [new MessageNode(`No results for "${this.searchQuery}"`)];
		}

		// Group by category
		const groups = new Map<string, RemoteSoulNode[]>();
		for (const soul of souls) {
			const cat = soul.category || 'uncategorized';
			if (!groups.has(cat)) groups.set(cat, []);
			groups.get(cat)!.push(new RemoteSoulNode(soul));
		}

		const categories: CategoryNode[] = [];
		for (const [cat, children] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			categories.push(new CategoryNode(cat, children));
		}
		return categories;
	}

	private async loadRemoteSouls(): Promise<void> {
		try {
			const resp = await apiGet('/souls?limit=200');
			this.remoteCache = resp.souls || [];
			this.refresh();
		} catch (err: any) {
			console.error('Failed to load remote souls:', err.message);
			// Retry after 10s
			setTimeout(() => this.loadRemoteSouls(), 10000);
		}
	}

	private async searchSouls(): Promise<void> {
		const query = await vscode.window.showInputBox({
			prompt: 'Search souls by name, tag, or description',
			placeHolder: 'e.g. developer, writing, korean...',
			value: this.searchQuery
		});
		if (query !== undefined) {
			this.searchQuery = query;
			this.viewMode = 'browse';
			this.refresh();
		}
	}

	private toggleView(): void {
		this.viewMode = this.viewMode === 'browse' ? 'local' : 'browse';
		this.refresh();
	}

	private async previewSoul(node: RemoteSoulNode): Promise<void> {
		const soul = node.soul;
		try {
			const detail = await apiGet(`/souls/${soul.owner}/${soul.name}`);
			const panel = vscode.window.createWebviewPanel(
				'soulPreview',
				`${soul.displayName} — Soul Preview`,
				vscode.ViewColumn.One,
				{ enableScripts: false }
			);
			panel.webview.html = this.getSoulPreviewHtml(detail);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to load soul: ${err.message}`);
		}
	}

	private getSoulPreviewHtml(soul: any): string {
		const tags = (soul.tags || []).map((t: string) => `<span class="tag">${t}</span>`).join(' ');
		const files = Object.entries(soul.files || {}).map(([k, v]) => `<li><b>${k}</b>: ${v}</li>`).join('');
		const scan = soul.latestScan
			? `<p>🔍 SoulScan: <b>${soul.latestScan.score}/100</b> (${soul.latestScan.status})</p>`
			: '';

		return `<!DOCTYPE html>
<html>
<head>
<style>
body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
h1 { margin-bottom: 4px; }
.meta { color: var(--vscode-descriptionForeground); margin-bottom: 16px; }
.tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-right: 4px; }
.section { margin-top: 16px; }
.btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; border-radius: 4px; font-size: 14px; }
</style>
</head>
<body>
<h1>${soul.displayName || soul.name}</h1>
<p class="meta">${soul.fullName} · v${soul.version} · ${soul.license} · ⬇ ${soul.downloads}</p>
<p>${soul.description || ''}</p>
<div>${tags}</div>
${scan}
<div class="section">
<h3>📁 Files</h3>
<ul>${files || '<li>No files</li>'}</ul>
</div>
<div class="section">
<p>To apply this soul, use the command: <b>ClawSouls: Apply Soul</b></p>
</div>
</body>
</html>`;
	}

	private getWorkspaceDirectory(): string {
		const { getWorkspaceDir } = require('../paths');
		return getWorkspaceDir();
	}

	private async applySoul(node: RemoteSoulNode): Promise<void> {
		const soul = node.soul;
		const workspaces = vscode.workspace.workspaceFolders;

		// Write to SoulClaw workspace only (engine reads from here)
		const workspaceDir = this.getWorkspaceDirectory();
		const targetDirs: string[] = [workspaceDir];
		const targetDir = workspaceDir;
		const confirm = await vscode.window.showInformationMessage(
			`Apply "${soul.displayName}"? Soul files will be saved to SoulClaw workspace.`,
			'Apply', 'Cancel'
		);
		if (confirm !== 'Apply') return;

		try {
			// Fetch full soul detail with file contents
			const detail = await apiGet(`/souls/${soul.owner}/${soul.name}?files=true`);

			const soulJson = {
				name: detail.name,
				displayName: detail.displayName,
				description: detail.description,
				version: detail.version,
				specVersion: '0.5',
				license: detail.license,
				tags: detail.tags,
				category: detail.category,
				author: detail.author,
				files: detail.files
			};

			// Map file contents: files array = filenames, fileContents = {index: content}
			const fileNames = Array.isArray(detail.files) ? detail.files as string[] : [];
			const fileContentsMap = detail.fileContents || {};

			// Filename mapping: soul→SOUL.md, identity→IDENTITY.md, etc.
			const fileNameMap: Record<string, string> = {
				'soul': 'SOUL.md',
				'identity': 'IDENTITY.md',
				'style': 'STYLE.md',
				'agents': 'AGENTS.md',
				'readme': 'README.md',
				'heartbeat': 'HEARTBEAT.md',
				'user': 'USER.md',
				'memory': 'MEMORY.md',
				'tools': 'TOOLS.md',
				'bootstrap': 'BOOTSTRAP.md',
				'soul.json': 'soul.json',  // skip, we write our own
			};

			// Write to target directories
			for (const dir of targetDirs) {
				fs.mkdirSync(dir, { recursive: true });

				// Write soul.json
				fs.writeFileSync(path.join(dir, 'soul.json'), JSON.stringify(soulJson, null, 2));

				// Write file contents
				for (let i = 0; i < fileNames.length; i++) {
					const key = fileNames[i];
					const content = fileContentsMap[String(i)];
					if (!content || key === 'soul.json') continue;
					const filename = fileNameMap[key] || `${key.toUpperCase()}.md`;
					fs.writeFileSync(path.join(dir, filename), content);
				}
			}

			// Add .clawsouls to .gitignore if workspace has one
			if (workspaces && workspaces.length > 0) {
				const gitignorePath = path.join(workspaces[0].uri.fsPath, '.gitignore');
				if (fs.existsSync(gitignorePath)) {
					const content = fs.readFileSync(gitignorePath, 'utf8');
					if (!content.includes('.clawsouls/')) {
						fs.appendFileSync(gitignorePath, '\n.clawsouls/\n');
					}
				}
			}

			const dirs = targetDirs.map(d => path.basename(path.dirname(d)) + '/' + path.basename(d)).join(', ');
			// Ask to clear previous memory
			const clearMem = await vscode.window.showInformationMessage(
				`✅ Soul "${soul.displayName}" applied. Clear previous memory files?`,
				'Clear Memory', 'Keep Memory'
			);
			if (clearMem === 'Clear Memory') {
				const workspaceRoot = targetDirs[0]; // SoulClaw workspace
				const memoryFiles = ['MEMORY.md', 'USER.md'];
				const memoryDir = path.join(workspaceRoot, 'memory');
				for (const f of memoryFiles) {
					const fp = path.join(workspaceRoot, f);
					if (fs.existsSync(fp)) fs.unlinkSync(fp);
				}
				if (fs.existsSync(memoryDir)) {
					fs.rmSync(memoryDir, { recursive: true, force: true });
				}
			}
			this.refresh();

			// Refresh status bar soul name
			try {
				await vscode.commands.executeCommand('clawsouls.refreshStatusBar');
			} catch {}

			// Restart engine so the new soul takes effect
			try {
				await vscode.commands.executeCommand('clawsouls.restartGateway');
			} catch {
				// Best effort — engine may not be running
			}
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to apply soul: ${err.message}`);
		}
	}

	private async publishSoul(): Promise<void> {
		const { getWorkspaceDir } = require('../paths');
		const wsDir = getWorkspaceDir();
		const soulJsonPath = path.join(wsDir, 'soul.json');
		
		if (!fs.existsSync(soulJsonPath)) {
			vscode.window.showWarningMessage('No soul.json found. Create a soul first.');
			return;
		}

		const terminal = vscode.window.createTerminal({ name: 'Soul Publish', cwd: wsDir });
		terminal.show();
		terminal.sendText('npx clawsouls publish');
	}

	private async diffSoul(node: RemoteSoulNode): Promise<void> {
		const soul = node.soul;
		try {
			const detail = await apiGet(`/souls/${soul.owner}/${soul.name}?files=true`);
			const { getWorkspaceDir } = require('../paths');
			const localSoulPath = path.join(getWorkspaceDir(), 'SOUL.md');
			
			if (!fs.existsSync(localSoulPath)) {
				vscode.window.showWarningMessage('No local SOUL.md to compare.');
				return;
			}

			// Write remote content to temp file
			const os = require('os');
			const tmpDir = path.join(os.tmpdir(), 'soulclaw-diff');
			fs.mkdirSync(tmpDir, { recursive: true });
			const remoteSoulPath = path.join(tmpDir, 'SOUL.md.remote');
			const remoteContent = detail.fileContents?.['0'] || detail.description || '(no content)';
			fs.writeFileSync(remoteSoulPath, remoteContent);

			await vscode.commands.executeCommand('vscode.diff',
				vscode.Uri.file(localSoulPath),
				vscode.Uri.file(remoteSoulPath),
				`SOUL.md: Local ↔ ${soul.fullName}`
			);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Diff failed: ${err.message}`);
		}
	}

	private async bumpVersion(): Promise<void> {
		const { getWorkspaceDir } = require('../paths');
		const soulJsonPath = path.join(getWorkspaceDir(), 'soul.json');
		
		if (!fs.existsSync(soulJsonPath)) {
			vscode.window.showWarningMessage('No soul.json found.');
			return;
		}

		try {
			const content = JSON.parse(fs.readFileSync(soulJsonPath, 'utf-8'));
			const currentVersion = content.version || '0.0.0';
			const parts = currentVersion.split('.').map(Number);
			
			const bump = await vscode.window.showQuickPick(
				[
					{ label: `Patch (${parts[0]}.${parts[1]}.${parts[2] + 1})`, value: 'patch' },
					{ label: `Minor (${parts[0]}.${parts[1] + 1}.0)`, value: 'minor' },
					{ label: `Major (${parts[0] + 1}.0.0)`, value: 'major' },
				],
				{ placeHolder: `Current: ${currentVersion}` }
			);
			if (!bump) return;

			if (bump.value === 'patch') parts[2]++;
			else if (bump.value === 'minor') { parts[1]++; parts[2] = 0; }
			else { parts[0]++; parts[1] = 0; parts[2] = 0; }

			content.version = parts.join('.');
			fs.writeFileSync(soulJsonPath, JSON.stringify(content, null, 2));
			vscode.window.showInformationMessage(`Version bumped to ${content.version}`);
			this.refresh();
		} catch (err: any) {
			vscode.window.showErrorMessage(`Version bump failed: ${err.message}`);
		}
	}

	private async getLocalFiles(): Promise<LocalSoulFile[]> {
		const workspaces = vscode.workspace.workspaceFolders;
		if (!workspaces) return [];

		const files: LocalSoulFile[] = [];
		for (const ws of workspaces) {
			const found = this.findLocalSoulFiles(ws.uri.fsPath);
			files.push(...found);
		}
		return files.sort((a, b) => (a.label as string).localeCompare(b.label as string));
	}

	private findLocalSoulFiles(dirPath: string): LocalSoulFile[] {
		const results: LocalSoulFile[] = [];
		const filenames = ['soul.json', 'SOUL.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md'];

		for (const filename of filenames) {
			const filePath = path.join(dirPath, filename);
			if (fs.existsSync(filePath)) {
				results.push(new LocalSoulFile(filename, filePath));
			}
		}

		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
					const sub = this.findLocalSoulFiles(path.join(dirPath, entry.name));
					sub.forEach(f => {
						f.label = `${entry.name}/${f.label}`;
					});
					results.push(...sub);
				}
			}
		} catch {}

		return results;
	}
}

class CategoryNode extends vscode.TreeItem {
	constructor(
		public readonly categoryName: string,
		public readonly children: RemoteSoulNode[]
	) {
		super(categoryName, vscode.TreeItemCollapsibleState.Collapsed);
		this.description = `${children.length}`;
		this.iconPath = new vscode.ThemeIcon('folder');
		this.contextValue = 'category';
	}
}

class RemoteSoulNode extends vscode.TreeItem {
	constructor(public readonly soul: SoulSummary) {
		super(soul.displayName || soul.name, vscode.TreeItemCollapsibleState.None);

		const scanIcon = soul.scanStatus === 'pass' ? '✅' : soul.scanStatus === 'warn' ? '⚠️' : '❌';
		this.description = `${soul.fullName} · ⬇${soul.downloads} ${scanIcon}`;
		this.tooltip = `${soul.description}\n\nTags: ${soul.tags.join(', ')}\nVersion: ${soul.version}\nScan: ${soul.scanScore ?? '-'}/100`;
		this.iconPath = new vscode.ThemeIcon('person');
		this.contextValue = 'remoteSoul';

		this.command = {
			command: 'clawsouls.soulExplorer.preview',
			title: 'Preview Soul',
			arguments: [this]
		};
	}
}

class LocalSoulFile extends vscode.TreeItem {
	constructor(
		public label: string,
		public readonly filePath: string
	) {
		super(label, vscode.TreeItemCollapsibleState.None);

		const icon = label.toLowerCase() === 'soul.json' ? 'settings-gear'
			: label.toLowerCase() === 'soul.md' ? 'person'
			: label.toLowerCase() === 'agents.md' ? 'organization'
			: label.toLowerCase() === 'memory.md' ? 'database'
			: label.toLowerCase() === 'identity.md' ? 'key'
			: 'file';

		this.iconPath = new vscode.ThemeIcon(icon);
		this.contextValue = 'localSoulFile';

		try {
			const stats = fs.statSync(filePath);
			const kb = Math.round(stats.size / 1024);
			this.description = kb > 0 ? `${kb}KB` : `${stats.size}B`;
		} catch {}

		this.command = {
			command: 'vscode.open',
			title: 'Open',
			arguments: [vscode.Uri.file(filePath)]
		};
	}
}

class MessageNode extends vscode.TreeItem {
	constructor(message: string) {
		super(message, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon('info');
	}
}
