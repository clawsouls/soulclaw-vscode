import * as vscode from 'vscode';

/**
 * CodeLens provider that adds "Ask SoulClaw | Explain | Fix" above functions/classes.
 */
export class SoulClawCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChange.event;

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const lenses: vscode.CodeLens[] = [];
		const text = document.getText();
		const lang = document.languageId;

		// Match function/class/method declarations
		const patterns = this.getPatternsForLanguage(lang);
		for (const pattern of patterns) {
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(text)) !== null) {
				const pos = document.positionAt(match.index);
				const range = new vscode.Range(pos, pos);

				lenses.push(
					new vscode.CodeLens(range, {
						title: '🔮 Ask SoulClaw',
						command: 'soulclaw.askAboutCode',
					}),
					new vscode.CodeLens(range, {
						title: 'Explain',
						command: 'soulclaw.explainCode',
					}),
					new vscode.CodeLens(range, {
						title: 'Fix',
						command: 'soulclaw.fixCode',
					}),
				);
			}
		}

		return lenses;
	}

	private getPatternsForLanguage(lang: string): RegExp[] {
		switch (lang) {
			case 'typescript':
			case 'javascript':
			case 'typescriptreact':
			case 'javascriptreact':
				return [
					/^[ \t]*(?:export\s+)?(?:async\s+)?function\s+\w+/gm,
					/^[ \t]*(?:export\s+)?(?:abstract\s+)?class\s+\w+/gm,
				];
			case 'python':
				return [
					/^[ \t]*(?:async\s+)?def\s+\w+/gm,
					/^[ \t]*class\s+\w+/gm,
				];
			case 'go':
				return [
					/^func\s+(?:\([^)]+\)\s+)?\w+/gm,
					/^type\s+\w+\s+struct/gm,
				];
			case 'rust':
				return [
					/^[ \t]*(?:pub\s+)?(?:async\s+)?fn\s+\w+/gm,
					/^[ \t]*(?:pub\s+)?struct\s+\w+/gm,
					/^[ \t]*(?:pub\s+)?impl\s+/gm,
				];
			case 'java':
			case 'kotlin':
			case 'csharp':
				return [
					/^[ \t]*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:[\w<>\[\]]+\s+)\w+\s*\(/gm,
					/^[ \t]*(?:public|private|protected|internal)?\s*(?:abstract\s+)?class\s+\w+/gm,
				];
			default:
				return [
					/^[ \t]*(?:export\s+)?(?:async\s+)?function\s+\w+/gm,
					/^[ \t]*class\s+\w+/gm,
				];
		}
	}
}
