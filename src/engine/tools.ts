/**
 * Tool definitions and execution for the embedded engine.
 * Provides file operations, terminal commands, and workspace tools.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface ToolCall {
	name: string;
	args: Record<string, any>;
}

export interface ToolResult {
	success: boolean;
	output: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	{
		name: 'read_file',
		description: 'Read the contents of a file. Returns the file content as text.',
		parameters: {
			path: { type: 'string', description: 'Absolute or relative path to the file', required: true },
		},
	},
	{
		name: 'write_file',
		description: 'Write content to a file. Creates the file and parent directories if they don\'t exist.',
		parameters: {
			path: { type: 'string', description: 'Path to write to', required: true },
			content: { type: 'string', description: 'Content to write', required: true },
		},
	},
	{
		name: 'edit_file',
		description: 'Replace exact text in a file. The old_text must match exactly.',
		parameters: {
			path: { type: 'string', description: 'Path to the file', required: true },
			old_text: { type: 'string', description: 'Exact text to find', required: true },
			new_text: { type: 'string', description: 'Text to replace with', required: true },
		},
	},
	{
		name: 'list_files',
		description: 'List files in a directory.',
		parameters: {
			path: { type: 'string', description: 'Directory path', required: true },
			recursive: { type: 'boolean', description: 'List recursively (default: false)' },
		},
	},
	{
		name: 'run_command',
		description: 'Execute a shell command and return the output. Use for builds, tests, git, etc.',
		parameters: {
			command: { type: 'string', description: 'Shell command to execute', required: true },
			cwd: { type: 'string', description: 'Working directory (optional)' },
		},
	},
	{
		name: 'memory_search',
		description: 'Search through MEMORY.md and memory/*.md files for relevant past context, decisions, and notes.',
		parameters: {
			query: { type: 'string', description: 'Search query', required: true },
		},
	},
	{
		name: 'search_files',
		description: 'Search for text in files using grep.',
		parameters: {
			pattern: { type: 'string', description: 'Search pattern (regex)', required: true },
			path: { type: 'string', description: 'Directory to search in', required: true },
			include: { type: 'string', description: 'File glob pattern (e.g. "*.ts")' },
		},
	},
];

/** Convert tool definitions to Anthropic API format */
export function getAnthropicTools(): any[] {
	return TOOL_DEFINITIONS.map(t => ({
		name: t.name,
		description: t.description,
		input_schema: {
			type: 'object',
			properties: Object.fromEntries(
				Object.entries(t.parameters).map(([key, val]) => [key, { type: val.type, description: val.description }])
			),
			required: Object.entries(t.parameters).filter(([_, v]) => v.required).map(([k]) => k),
		},
	}));
}

/** Convert tool definitions to OpenAI API format */
export function getOpenAITools(): any[] {
	return TOOL_DEFINITIONS.map(t => ({
		type: 'function',
		function: {
			name: t.name,
			description: t.description,
			parameters: {
				type: 'object',
				properties: Object.fromEntries(
					Object.entries(t.parameters).map(([key, val]) => [key, { type: val.type, description: val.description }])
				),
				required: Object.entries(t.parameters).filter(([_, v]) => v.required).map(([k]) => k),
			},
		},
	}));
}

/** Execute a tool call and return the result */
export function executeTool(call: ToolCall, workspaceDir: string): ToolResult {
	try {
		switch (call.name) {
			case 'read_file':
				return readFile(resolvePath(call.args.path, workspaceDir));
			case 'write_file':
				return writeFile(resolvePath(call.args.path, workspaceDir), call.args.content);
			case 'edit_file':
				return editFile(resolvePath(call.args.path, workspaceDir), call.args.old_text, call.args.new_text);
			case 'list_files':
				return listFiles(resolvePath(call.args.path, workspaceDir), call.args.recursive);
			case 'run_command':
				return runCommand(call.args.command, call.args.cwd || workspaceDir);
			case 'memory_search': {
				const { searchMemory } = require('./memory-search');
				const results = searchMemory(workspaceDir, call.args.query);
				if (results.length === 0) return { success: true, output: 'No matching memories found.' };
				const output = results.map((r: any) => `[${r.file}:${r.line}] (score:${r.score.toFixed(2)}) ${r.text}`).join('\n');
				return { success: true, output };
			}
			case 'search_files':
				return searchFiles(call.args.pattern, resolvePath(call.args.path, workspaceDir), call.args.include);
			default:
				return { success: false, output: `Unknown tool: ${call.name}` };
		}
	} catch (err: any) {
		return { success: false, output: `Error: ${err.message}` };
	}
}

/** Sensitive file patterns — warn before reading */
const SENSITIVE_PATTERNS = [
	/\.env$/i, /\.env\.\w+$/i, /credentials/i, /\.pem$/i, /\.key$/i,
	/id_rsa/, /id_ed25519/, /\.ssh\/config/, /\.netrc/, /\.npmrc/,
	/password/i, /secret/i, /token/i,
];

function isSensitiveFile(filePath: string): boolean {
	const base = path.basename(filePath);
	return SENSITIVE_PATTERNS.some(p => p.test(base) || p.test(filePath));
}

function resolvePath(p: string, workspaceDir: string): string {
	if (path.isAbsolute(p)) return p;
	return path.resolve(workspaceDir, p);
}

/** Check if path is within allowed workspace scope */
function isWithinScope(filePath: string, workspaceDir: string): boolean {
	const resolved = path.resolve(filePath);
	const wsResolved = path.resolve(workspaceDir);
	// Allow workspace, home dir project paths, and /tmp
	return resolved.startsWith(wsResolved) ||
		resolved.startsWith(path.join(process.env.HOME || '', 'projects')) ||
		resolved.startsWith('/tmp') ||
		resolved.startsWith(process.env.TMPDIR || '/tmp');
}

function readFile(filePath: string): ToolResult {
	if (!fs.existsSync(filePath)) {
		return { success: false, output: `File not found: ${filePath}` };
	}
	if (isSensitiveFile(filePath)) {
		return { success: false, output: `⚠️ Blocked: "${path.basename(filePath)}" appears to be a sensitive file (credentials/keys). Use read_file only on source code files.` };
	}
	const stat = fs.statSync(filePath);
	if (stat.size > 512 * 1024) {
		return { success: false, output: `File too large (${(stat.size / 1024).toFixed(0)}KB > 512KB limit)` };
	}
	const content = fs.readFileSync(filePath, 'utf-8');
	return { success: true, output: content };
}

function writeFile(filePath: string, content: string): ToolResult {
	// Scope check — don't write outside workspace
	const resolved = path.resolve(filePath);
	const home = process.env.HOME || '';
	const blockedPrefixes = [path.join(home, '.ssh'), '/etc', '/usr', '/System', '/Library'];
	if (blockedPrefixes.some(p => resolved.startsWith(p))) {
		return { success: false, output: `⚠️ Blocked: Cannot write to system directory "${filePath}".` };
	}
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
	return { success: true, output: `Written ${content.length} bytes to ${filePath}` };
}

function editFile(filePath: string, oldText: string, newText: string): ToolResult {
	if (!fs.existsSync(filePath)) {
		return { success: false, output: `File not found: ${filePath}` };
	}
	const content = fs.readFileSync(filePath, 'utf-8');
	if (!content.includes(oldText)) {
		return { success: false, output: `Text not found in file. Make sure old_text matches exactly.` };
	}
	const newContent = content.replace(oldText, newText);
	fs.writeFileSync(filePath, newContent);
	return { success: true, output: `Replaced text in ${filePath}` };
}

function listFiles(dirPath: string, recursive?: boolean): ToolResult {
	if (!fs.existsSync(dirPath)) {
		return { success: false, output: `Directory not found: ${dirPath}` };
	}

	const entries: string[] = [];
	function walk(dir: string, prefix: string = '') {
		const items = fs.readdirSync(dir, { withFileTypes: true });
		for (const item of items) {
			if (item.name.startsWith('.') || item.name === 'node_modules') continue;
			const rel = prefix ? `${prefix}/${item.name}` : item.name;
			if (item.isDirectory()) {
				entries.push(`${rel}/`);
				if (recursive) walk(path.join(dir, item.name), rel);
			} else {
				entries.push(rel);
			}
		}
	}
	walk(dirPath);
	return { success: true, output: entries.join('\n') || '(empty directory)' };
}

/** Show command in VSCode terminal for visibility */
function showInTerminal(command: string, cwd: string): void {
	try {
		const vscode = require('vscode');
		let terminal = vscode.window.terminals.find((t: any) => t.name === 'SoulClaw');
		if (!terminal) {
			terminal = vscode.window.createTerminal({ name: 'SoulClaw', cwd });
		}
		terminal.show(true); // preserve focus
		terminal.sendText(`# SoulClaw executed: ${command}`, false);
	} catch {}
}

function runCommand(command: string, cwd: string): ToolResult {
	showInTerminal(command, cwd);
	try {
		const output = execSync(command, {
			cwd,
			encoding: 'utf-8',
			timeout: 30_000,
			maxBuffer: 1024 * 1024,
			env: { ...process.env, FORCE_COLOR: '0' },
		});
		return { success: true, output: output.trim() || '(no output)' };
	} catch (err: any) {
		const output = (err.stdout || '') + (err.stderr || '');
		return { success: false, output: output.trim() || err.message };
	}
}

function searchFiles(pattern: string, dirPath: string, include?: string): ToolResult {
	try {
		const globFlag = include ? `--include="${include}"` : '';
		const output = execSync(
			`grep -rn ${globFlag} "${pattern}" .`,
			{ cwd: dirPath, encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 }
		);
		return { success: true, output: output.trim() };
	} catch (err: any) {
		if (err.status === 1) return { success: true, output: '(no matches)' };
		return { success: false, output: err.message };
	}
}
