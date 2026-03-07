/**
 * System prompt builder — assembles the full system prompt
 * from bootstrap files, runtime context, and tool descriptions.
 */

import * as os from 'os';
import type { BootstrapFile } from './types';
import { buildSystemPromptContext } from './bootstrap';

export interface PromptContext {
	bootstrapFiles: BootstrapFile[];
	sessionKey: string;
	workspaceDir: string;
	model: string;
	channel?: string;
}

export function buildSystemPrompt(ctx: PromptContext): string {
	const workspaceContext = buildSystemPromptContext(ctx.bootstrapFiles);

	const sections: string[] = [];

	// Runtime header
	sections.push(`## Runtime
Runtime: agent=main | host=${os.hostname()} | os=${os.platform()} ${os.arch()} | model=${ctx.model}
Workspace: ${ctx.workspaceDir}`);

	// Workspace files
	if (workspaceContext) {
		sections.push(`# Project Context
The following project context files have been loaded:
If SOUL.md is present, embody its persona and tone.

${workspaceContext}`);
	}

	// Tool usage
	sections.push(`## Available Tools
You have access to tools for file operations and command execution:
- **read_file**: Read file contents
- **write_file**: Create or overwrite files
- **edit_file**: Replace exact text in files
- **list_files**: List directory contents
- **run_command**: Execute shell commands (builds, tests, git, etc.)
- **search_files**: Search for text patterns in files

Use tools proactively when the user asks you to write, edit, fix, or analyze code. Always read relevant files before making changes.`);

	// Memory recall instruction
	sections.push(`## Memory Recall
Before answering anything about prior work, decisions, dates, people, preferences, or todos: use the information available in your context. If you have memory files loaded, reference them directly.`);

	// Silent replies
	sections.push(`## Silent Replies
When you have nothing to say, respond with ONLY: NO_REPLY
It must be your ENTIRE message — nothing else.`);

	// Date/time
	const now = new Date();
	sections.push(`## Current Date & Time
${now.toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

	return sections.join('\n\n');
}
