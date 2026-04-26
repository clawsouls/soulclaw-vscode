import * as vscode from 'vscode';
import * as path from 'path';
import { scanSoulFiles, ScanResult, ScanIssue } from '../engine/soulscan';
import { getWorkspaceDir } from '../paths';

type SoulScanNode = ScanSummaryNode | ScanIssueNode | ScanActionNode | ScanCategoryNode;

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
		if (!element) {
			// Root level
			if (!this.result) {
				return [new ScanActionNode('▶️ Run SoulScan', 'clawsouls.runScan')];
			}

			const r = this.result;
			const items: SoulScanNode[] = [];

			// Summary
			const gradeIcon = r.score >= 90 ? '🟢' : r.score >= 75 ? '🟡' : r.score >= 50 ? '🟠' : '🔴';
			items.push(new ScanSummaryNode(
				`${gradeIcon} Score: ${r.score}/100 (${r.grade}) — ${r.issues.length} issue${r.issues.length !== 1 ? 's' : ''}`,
				`${r.fileCount} files scanned`
			));

			// 4-layer breakdown badge — always rendered so the panel
			// reflects the README "4-layer contamination detection"
			// statement even when individual layers have zero findings.
			const c = r.categories;
			items.push(new ScanSummaryNode(
				`📊 4-layer: SEC ${c.security} · PII ${c.pii} · QUA ${c.quality} · INT ${c.integrity}`,
				''
			));

			if (r.issues.length === 0) {
				items.push(new ScanSummaryNode('✅ No issues found', 'All soul files look clean'));
				return items;
			}

			// Category groups — render only non-empty layers, in fixed
			// order (SEC → PII → QUA → INT) matching the badge above.
			const secIssues = r.issues.filter(i => i.category === 'security');
			const piiIssues = r.issues.filter(i => i.category === 'pii');
			const quaIssues = r.issues.filter(i => i.category === 'quality');
			const intIssues = r.issues.filter(i => i.category === 'integrity');

			if (secIssues.length > 0) items.push(new ScanCategoryNode('security', secIssues));
			if (piiIssues.length > 0) items.push(new ScanCategoryNode('pii', piiIssues));
			if (quaIssues.length > 0) items.push(new ScanCategoryNode('quality', quaIssues));
			if (intIssues.length > 0) items.push(new ScanCategoryNode('integrity', intIssues));

			return items;
		}

		// Children of category node
		if (element instanceof ScanCategoryNode) {
			return element.issues.map(i => new ScanIssueNode(i));
		}

		return [];
	}
}

class ScanSummaryNode extends vscode.TreeItem {
	constructor(label: string, description: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.contextValue = 'scanSummary';
	}
}

class ScanCategoryNode extends vscode.TreeItem {
	constructor(
		public readonly cat: 'security' | 'pii' | 'quality' | 'integrity',
		public readonly issues: ScanIssue[]
	) {
		const icon =
			cat === 'security' ? '🔒' :
			cat === 'pii' ? '🪪' :
			cat === 'quality' ? '📋' :
			'🔐';
		const label =
			cat === 'security' ? 'Security' :
			cat === 'pii' ? 'PII' :
			cat === 'quality' ? 'Quality' :
			'Integrity';
		super(`${icon} ${label} (${issues.length} issue${issues.length !== 1 ? 's' : ''})`, vscode.TreeItemCollapsibleState.Expanded);
		this.contextValue = 'scanCategory';
	}
}

class ScanIssueNode extends vscode.TreeItem {
	constructor(public readonly issue: ScanIssue) {
		const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
		super(`${icon} ${issue.rule}: ${issue.message}`, vscode.TreeItemCollapsibleState.None);

		this.description = issue.file ? `${issue.file}${issue.line ? ':' + issue.line : ''}` : '';
		this.tooltip = `${issue.severity.toUpperCase()}: ${issue.message}${issue.file ? `\n${issue.file}${issue.line ? ':' + issue.line : ''}` : ''}`;
		this.contextValue = 'scanIssue';

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
