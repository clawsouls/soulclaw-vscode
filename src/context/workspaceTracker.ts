import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface WorkspaceContext {
	workspacePath?: string;
	currentFile?: string;
	openFiles: string[];
	gitBranch?: string;
	projectType?: string;
	soulConfig?: any;
}

export class WorkspaceTracker {
	private context: WorkspaceContext = {
		openFiles: []
	};
	
	constructor(private extensionContext: vscode.ExtensionContext) {
		this.setupEventListeners();
		this.updateContext();
	}
	
	private setupEventListeners(): void {
		// Listen for active editor changes
		vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged.bind(this));
		
		// Listen for file saves
		vscode.workspace.onDidSaveTextDocument(this.onDocumentSaved.bind(this));
		
		// Listen for workspace changes
		vscode.workspace.onDidChangeWorkspaceFolders(this.updateContext.bind(this));
		
		// Listen for configuration changes
		vscode.workspace.onDidChangeConfiguration(this.onConfigurationChanged.bind(this));
	}
	
	private onActiveEditorChanged(editor?: vscode.TextEditor): void {
		if (editor) {
			this.context.currentFile = editor.document.fileName;
		}
		this.updateOpenFiles();
	}
	
	private onDocumentSaved(document: vscode.TextDocument): void {
		// If a soul file was saved, reload soul config
		const fileName = path.basename(document.fileName).toLowerCase();
		if (fileName === 'soul.json') {
			this.loadSoulConfig();
		}
	}
	
	private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
		if (event.affectsConfiguration('clawsouls')) {
			this.updateContext();
		}
	}
	
	private updateContext(): void {
		this.updateWorkspacePath();
		this.updateOpenFiles();
		this.updateProjectType();
		this.loadSoulConfig();
		this.updateGitBranch();
		this.syncProjectToToolsMd();
	}
	
	private updateWorkspacePath(): void {
		const workspaces = vscode.workspace.workspaceFolders;
		if (workspaces && workspaces.length > 0) {
			this.context.workspacePath = workspaces[0].uri.fsPath;
		} else {
			this.context.workspacePath = undefined;
		}
	}
	
	private updateOpenFiles(): void {
		this.context.openFiles = vscode.window.tabGroups.all
			.flatMap(group => group.tabs)
			.map(tab => {
				if (tab.input instanceof vscode.TabInputText) {
					return tab.input.uri.fsPath;
				}
				return '';
			})
			.filter(path => path !== '');
	}
	
	private updateProjectType(): void {
		if (!this.context.workspacePath) {
			this.context.projectType = undefined;
			return;
		}
		
		const rootPath = this.context.workspacePath;
		
		// Check for common project types
		if (this.fileExists(path.join(rootPath, 'package.json'))) {
			this.context.projectType = 'node';
		} else if (this.fileExists(path.join(rootPath, 'requirements.txt')) || 
				   this.fileExists(path.join(rootPath, 'pyproject.toml'))) {
			this.context.projectType = 'python';
		} else if (this.fileExists(path.join(rootPath, 'Cargo.toml'))) {
			this.context.projectType = 'rust';
		} else if (this.fileExists(path.join(rootPath, 'go.mod'))) {
			this.context.projectType = 'go';
		} else if (this.fileExists(path.join(rootPath, 'pom.xml')) || 
				   this.fileExists(path.join(rootPath, 'build.gradle'))) {
			this.context.projectType = 'java';
		} else {
			this.context.projectType = 'unknown';
		}
	}
	
	private async loadSoulConfig(): Promise<void> {
		if (!this.context.workspacePath) {
			this.context.soulConfig = undefined;
			return;
		}
		
		try {
			const soulJsonPath = path.join(this.context.workspacePath, 'soul.json');
			const document = await vscode.workspace.openTextDocument(soulJsonPath);
			this.context.soulConfig = JSON.parse(document.getText());
		} catch (error) {
			this.context.soulConfig = undefined;
		}
	}
	
	private updateGitBranch(): void {
		// For MVP, we'll implement a simple git branch detection
		// This could be expanded to use the built-in Git extension API
		if (!this.context.workspacePath) {
			this.context.gitBranch = undefined;
			return;
		}
		
		try {
			const gitHeadPath = path.join(this.context.workspacePath, '.git', 'HEAD');
			if (this.fileExists(gitHeadPath)) {
				// This is a simplified implementation
				// A full implementation would read the HEAD file and resolve refs
				this.context.gitBranch = 'main'; // Default
			}
		} catch (error) {
			this.context.gitBranch = undefined;
		}
	}
	
	private fileExists(filePath: string): boolean {
		try {
			const stat = vscode.workspace.fs.stat(vscode.Uri.file(filePath));
			return true;
		} catch {
			return false;
		}
	}
	
	/**
	 * Write current project info to {stateDir}/workspace/TOOLS.md
	 * so the LLM knows the active project path.
	 */
	private syncProjectToToolsMd(): void {
		if (!this.context.workspacePath) return;

		const { getWorkspaceDir } = require('../paths');
		const toolsMdPath = path.join(getWorkspaceDir(), 'TOOLS.md');
		const sectionHeader = '## Current Project';
		const newSection = [
			sectionHeader,
			`- **Path**: \`${this.context.workspacePath}\``,
			`- **Name**: ${path.basename(this.context.workspacePath)}`,
			this.context.projectType ? `- **Type**: ${this.context.projectType}` : '',
			this.context.gitBranch ? `- **Branch**: ${this.context.gitBranch}` : '',
			`- **Updated**: ${new Date().toISOString()}`,
		].filter(Boolean).join('\n');

		try {
			let content = '';
			if (fs.existsSync(toolsMdPath)) {
				content = fs.readFileSync(toolsMdPath, 'utf8');
			}

			// Replace existing section or append
			const sectionRegex = /## Current Project[\s\S]*?(?=\n## |\n---|\n$|$)/;
			if (sectionRegex.test(content)) {
				content = content.replace(sectionRegex, newSection);
			} else {
				content = content.trimEnd() + '\n\n' + newSection + '\n';
			}

			fs.writeFileSync(toolsMdPath, content, 'utf8');
		} catch {
			// Non-fatal — TOOLS.md may not exist yet
		}
	}

	public getContext(): WorkspaceContext {
		return { ...this.context }; // Return a copy to prevent external modification
	}
	
	public getCurrentFile(): string | undefined {
		return this.context.currentFile;
	}
	
	public getWorkspacePath(): string | undefined {
		return this.context.workspacePath;
	}
	
	public getSoulConfig(): any {
		return this.context.soulConfig;
	}
	
	public getProjectType(): string | undefined {
		return this.context.projectType;
	}
	
	public getRelativePath(absolutePath: string): string {
		if (!this.context.workspacePath) {
			return absolutePath;
		}
		
		try {
			return path.relative(this.context.workspacePath, absolutePath);
		} catch {
			return absolutePath;
		}
	}
}