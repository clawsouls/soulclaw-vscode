import * as vscode from 'vscode';
import * as path from 'path';
import { scanSoulFiles, ScanResult, ScanIssue } from '../engine/soulscan';
import { getWorkspaceDir } from '../paths';

type SoulScanNode = ScanSummaryNode | ScanIssueNode | ScanActionNode;

export class SoulScanProvider implements vscode.TreeDataProvider<SoulScanNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<SoulScanNode | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private result: ScanResult | null = null;

	constructor(private context: vscode.ExtensionContext) {}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	runScan(): void {
		const scanDir = getWorkspaceDir();
		this.result = scanSoulFiles(scanDir);
		this.refresh();
	}

	getLastResult(): ScanResult | null {
		return this.result;
	}

	getTreeItem(element: SoulScanNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: SoulScanNode): SoulScanNode[] {
		if (element) {
			return [];
		}

		// Not yet scanned — show action button
		if (!this.result) {
			return [new ScanActionNode('▶️ Run SoulScan', 'clawsouls.runScan')];
		}

		const r = this.result;
		const items: SoulScanNode[] = [];

		// Summary node
		const gradeIcon = r.score >= 90 ? '🟢' : r.score >= 75 ? '🟡' : r.score >= 60 ? '🟠' : '🔴';
		items.push(new ScanSummaryNode(
			`${gradeIcon} Score: ${r.score}/100 (${r.grade}) — ${r.issues.length} issue${r.issues.length !== 1 ? 's' : ''}`,
			`${r.fileCount} files scanned`
		));

		// Issue nodes
		for (const issue of r.issues) {
			items.push(new ScanIssueNode(issue));
		}

		if (r.issues.length === 0) {
			items.push(new ScanSummaryNode('✅ No issues found', 'All soul files look clean'));
		}

		return items;
	}
}

class ScanSummaryNode extends vscode.TreeItem {
	constructor(label: string, description: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.contextValue = 'scanSummary';
	}
}

class ScanIssueNode extends vscode.TreeItem {
	constructor(public readonly issue: ScanIssue) {
		const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
		super(`${icon} [${issue.rule}] ${issue.message}`, vscode.TreeItemCollapsibleState.None);

		this.description = issue.file ? `${issue.file}:${issue.line}` : '';
		this.tooltip = `${issue.severity.toUpperCase()}: ${issue.message}${issue.file ? `\n${issue.file}:${issue.line}` : ''}`;
		this.contextValue = 'scanIssue';

		// Click to navigate to file:line
		if (issue.file && issue.line !== undefined) {
			const filePath = path.join(getWorkspaceDir(), issue.file);
			this.command = {
				command: 'vscode.open',
				title: 'Go to Issue',
				arguments: [
					vscode.Uri.file(filePath),
					{ selection: new vscode.Range(issue.line - 1, 0, issue.line - 1, 0) } as vscode.TextDocumentShowOptions
				]
			};
		}
	}
}

class ScanActionNode extends vscode.TreeItem {
	constructor(label: string, commandId: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.command = { command: commandId, title: label };
		this.iconPath = new vscode.ThemeIcon('play');
		this.contextValue = 'scanAction';
	}
}
