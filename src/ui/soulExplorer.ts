import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SoulExplorerProvider implements vscode.TreeDataProvider<SoulFile> {
	private _onDidChangeTreeData: vscode.EventEmitter<SoulFile | undefined | null | void> = new vscode.EventEmitter<SoulFile | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<SoulFile | undefined | null | void> = this._onDidChangeTreeData.event;
	
	constructor(private context: vscode.ExtensionContext) {
		// Watch for file changes
		const fileWatcher = vscode.workspace.createFileSystemWatcher('**/{soul.json,SOUL.md,AGENTS.md,MEMORY.md,IDENTITY.md}');
		fileWatcher.onDidChange(() => this.refresh());
		fileWatcher.onDidCreate(() => this.refresh());
		fileWatcher.onDidDelete(() => this.refresh());
		
		context.subscriptions.push(fileWatcher);
	}
	
	refresh(): void {
		this._onDidChangeTreeData.fire();
	}
	
	getTreeItem(element: SoulFile): vscode.TreeItem {
		return element;
	}
	
	getChildren(element?: SoulFile): Thenable<SoulFile[]> {
		if (!element) {
			// Root level - scan workspace for soul files
			return Promise.resolve(this.getSoulFiles());
		}
		
		return Promise.resolve([]);
	}
	
	private async getSoulFiles(): Promise<SoulFile[]> {
		const workspaces = vscode.workspace.workspaceFolders;
		if (!workspaces) {
			return [];
		}
		
		const soulFiles: SoulFile[] = [];
		
		for (const workspace of workspaces) {
			const files = await this.findSoulFilesInDir(workspace.uri.fsPath);
			soulFiles.push(...files);
		}
		
		return soulFiles.sort((a, b) => a.label.localeCompare(b.label));
	}
	
	private async findSoulFilesInDir(dirPath: string): Promise<SoulFile[]> {
		const soulFiles: SoulFile[] = [];
		const filenames = ['soul.json', 'SOUL.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md'];
		
		for (const filename of filenames) {
			const filePath = path.join(dirPath, filename);
			
			if (fs.existsSync(filePath)) {
				const stats = fs.statSync(filePath);
				const soulFile = new SoulFile(
					filename,
					vscode.TreeItemCollapsibleState.None,
					filePath,
					this.getSoulFileType(filename),
					stats.mtime
				);
				
				// Add commands for each file
				soulFile.command = {
					command: 'vscode.open',
					title: 'Open',
					arguments: [vscode.Uri.file(filePath)]
				};
				
				soulFiles.push(soulFile);
			}
		}
		
		// Also scan subdirectories for soul files
		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
					const subDirPath = path.join(dirPath, entry.name);
					const subFiles = await this.findSoulFilesInDir(subDirPath);
					
					// Prefix with directory name for clarity
					subFiles.forEach(file => {
						file.label = `${entry.name}/${file.label}`;
						file.tooltip = `${entry.name}/${file.tooltip}`;
					});
					
					soulFiles.push(...subFiles);
				}
			}
		} catch (error) {
			// Ignore permission errors
		}
		
		return soulFiles;
	}
	
	private getSoulFileType(filename: string): SoulFileType {
		switch (filename.toLowerCase()) {
			case 'soul.json': return SoulFileType.Config;
			case 'soul.md': return SoulFileType.Persona;
			case 'agents.md': return SoulFileType.Agents;
			case 'memory.md': return SoulFileType.Memory;
			case 'identity.md': return SoulFileType.Identity;
			default: return SoulFileType.Unknown;
		}
	}
}

enum SoulFileType {
	Config = 'config',
	Persona = 'persona',
	Agents = 'agents',
	Memory = 'memory',
	Identity = 'identity',
	Unknown = 'unknown'
}

class SoulFile extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly filePath: string,
		public readonly fileType: SoulFileType,
		public readonly lastModified: Date,
		public command?: vscode.Command
	) {
		super(label, collapsibleState);
		
		this.tooltip = `${this.label} - Modified: ${this.lastModified.toLocaleString()}`;
		this.description = this.getDescription();
		this.iconPath = this.getIcon();
	}
	
	private getDescription(): string {
		const size = this.getFileSize();
		return size ? `${size}` : '';
	}
	
	private getFileSize(): string | null {
		try {
			const stats = fs.statSync(this.filePath);
			const sizeKB = Math.round(stats.size / 1024);
			return sizeKB > 0 ? `${sizeKB}KB` : `${stats.size}B`;
		} catch {
			return null;
		}
	}
	
	private getIcon(): vscode.ThemeIcon {
		switch (this.fileType) {
			case SoulFileType.Config:
				return new vscode.ThemeIcon('settings-gear');
			case SoulFileType.Persona:
				return new vscode.ThemeIcon('person');
			case SoulFileType.Agents:
				return new vscode.ThemeIcon('organization');
			case SoulFileType.Memory:
				return new vscode.ThemeIcon('database');
			case SoulFileType.Identity:
				return new vscode.ThemeIcon('key');
			default:
				return new vscode.ThemeIcon('file');
		}
	}
}