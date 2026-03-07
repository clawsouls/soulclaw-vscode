import * as vscode from 'vscode';
import * as path from 'path';
import { chatPanel } from '../extension';

export type CodeActionKind = 'ask' | 'explain' | 'fix' | 'context' | 'refactor' | 'test' | 'docs';

interface CodeSnippet {
	filePath: string;
	fileName: string;
	language: string;
	startLine: number;
	endLine: number;
	selectedText: string;
}

/** Shared context buffer — snippets accumulated via "Add to Context" */
const contextBuffer: CodeSnippet[] = [];

export function getContextBuffer(): CodeSnippet[] {
	return contextBuffer;
}

export function clearContextBuffer(): void {
	contextBuffer.length = 0;
}

function getSnippetFromEditor(): CodeSnippet | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.selection.isEmpty) {
		vscode.window.showWarningMessage('Select some code first.');
		return undefined;
	}

	const sel = editor.selection;
	const selectedText = editor.document.getText(sel);
	const ws = vscode.workspace.workspaceFolders;
	const absPath = editor.document.uri.fsPath;
	const relPath = ws?.length ? path.relative(ws[0].uri.fsPath, absPath) : path.basename(absPath);

	return {
		filePath: relPath,
		fileName: path.basename(absPath),
		language: editor.document.languageId,
		startLine: sel.start.line + 1,
		endLine: sel.end.line + 1,
		selectedText,
	};
}

function formatSnippetBlock(s: CodeSnippet): string {
	return `\`\`\`${s.language}\n// ${s.filePath}:${s.startLine}-${s.endLine}\n${s.selectedText}\n\`\`\``;
}

async function sendCodeAction(kind: CodeActionKind): Promise<void> {
	const snippet = getSnippetFromEditor();
	if (!snippet) return;

	if (kind === 'context') {
		contextBuffer.push(snippet);
		// Notify chat panel about context update
		chatPanel?.notifyContextUpdate(contextBuffer.map(s => ({
			label: `${s.filePath}:${s.startLine}-${s.endLine}`,
			snippet: s,
		})));
		vscode.window.showInformationMessage(
			`Added to context (${contextBuffer.length} snippet${contextBuffer.length > 1 ? 's' : ''})`
		);
		return;
	}

	let prompt: string;
	if (kind === 'ask') {
		const input = await vscode.window.showInputBox({
			placeHolder: 'Ask about this code...',
			prompt: `${snippet.filePath}:${snippet.startLine}-${snippet.endLine}`,
		});
		if (!input) return;
		prompt = `${input}\n\n${formatSnippetBlock(snippet)}`;
	} else if (kind === 'explain') {
		prompt = `Explain this code:\n\n${formatSnippetBlock(snippet)}`;
	} else if (kind === 'fix') {
		prompt = `Fix this code:\n\n${formatSnippetBlock(snippet)}`;
	} else if (kind === 'refactor') {
		prompt = `Refactor this code for better readability and maintainability:\n\n${formatSnippetBlock(snippet)}`;
	} else if (kind === 'test') {
		prompt = `Generate unit tests for this code:\n\n${formatSnippetBlock(snippet)}`;
	} else if (kind === 'docs') {
		prompt = `Generate documentation (JSDoc/docstring) for this code:\n\n${formatSnippetBlock(snippet)}`;
	}

	// Prepend any accumulated context
	if (contextBuffer.length > 0) {
		const ctxBlocks = contextBuffer.map(formatSnippetBlock).join('\n\n');
		prompt = `Context:\n${ctxBlocks}\n\n---\n\n${prompt}`;
		// Clear context after sending
		clearContextBuffer();
		chatPanel?.notifyContextUpdate([]);
	}

	chatPanel?.show();
	chatPanel?.sendFromExternal(prompt);
}

export function registerCodeActions(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('soulclaw.askAboutCode', () => sendCodeAction('ask')),
		vscode.commands.registerCommand('soulclaw.explainCode', () => sendCodeAction('explain')),
		vscode.commands.registerCommand('soulclaw.fixCode', () => sendCodeAction('fix')),
		vscode.commands.registerCommand('soulclaw.addToContext', () => sendCodeAction('context')),
		vscode.commands.registerCommand('soulclaw.refactorCode', () => sendCodeAction('refactor')),
		vscode.commands.registerCommand('soulclaw.generateTest', () => sendCodeAction('test')),
		vscode.commands.registerCommand('soulclaw.generateDocs', () => sendCodeAction('docs')),
		vscode.commands.registerCommand('soulclaw.clearContext', () => {
			clearContextBuffer();
			chatPanel?.notifyContextUpdate([]);
			vscode.window.showInformationMessage('Code context cleared.');
		}),
		// CodeLens action — select range then trigger code action
		vscode.commands.registerCommand('soulclaw.codeLensAction', async (uri: vscode.Uri, range: vscode.Range, kind: CodeActionKind) => {
			const editor = await vscode.window.showTextDocument(uri);
			editor.selection = new vscode.Selection(range.start, range.end);
			await sendCodeAction(kind);
		}),
	);
}
