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
				const startPos = document.positionAt(match.index);
				const range = new vscode.Range(startPos, startPos);

				// Find the end of this block (next function/class or EOF)
				const endLine = this.findBlockEnd(document, startPos.line);
				const selectRange = new vscode.Range(startPos, new vscode.Position(endLine, document.lineAt(endLine).text.length));

				lenses.push(
					new vscode.CodeLens(range, {
						title: '🔮 Ask SoulClaw',
						command: 'soulclaw.codeLensAction',
						arguments: [document.uri, selectRange, 'ask'],
					}),
					new vscode.CodeLens(range, {
						title: 'Explain',
						command: 'soulclaw.codeLensAction',
						arguments: [document.uri, selectRange, 'explain'],
					}),
					new vscode.CodeLens(range, {
						title: 'Fix',
						command: 'soulclaw.codeLensAction',
						arguments: [document.uri, selectRange, 'fix'],
					}),
				);
			}
		}

		return lenses;
	}

	/** Find end of a code block starting at given line */
	private findBlockEnd(document: vscode.TextDocument, startLine: number): number {
		let depth = 0;
		let foundOpen = false;
		
		for (let i = startLine; i < document.lineCount; i++) {
			const line = document.lineAt(i).text;
			for (const ch of line) {
				if (ch === '{') { depth++; foundOpen = true; }
				if (ch === '}') depth--;
				if (foundOpen && depth === 0) return i;
			}
		}
		
		// For Python/indent-based: find next line at same or lesser indent
		if (!foundOpen) {
			const startIndent = document.lineAt(startLine).firstNonWhitespaceCharacterIndex;
			for (let i = startLine + 1; i < document.lineCount; i++) {
				const line = document.lineAt(i);
				if (line.isEmptyOrWhitespace) continue;
				if (line.firstNonWhitespaceCharacterIndex <= startIndent) return i - 1;
			}
		}
		
		// Fallback: 30 lines or EOF
		return Math.min(startLine + 30, document.lineCount - 1);
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
