/**
 * SoulClaw Embedded Engine — runs the agent directly in-process.
 * No gateway, no WebSocket, no separate process.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import type { EngineConfig, EngineState, ChatMessage } from './types';
import { LLMClient, type LLMMessage } from './llm-client';
import { SessionStore } from './session-store';
import { loadWorkspaceFiles, filterByTier } from './bootstrap';
import { buildSystemPrompt } from './prompt-builder';
import { getAnthropicTools, executeTool, type ToolCall } from './tools';
import { loadPersonaProfile, detectDrift } from './drift-detector';

export class SoulClawEngine extends EventEmitter {
	private config!: EngineConfig;
	private llm!: LLMClient;
	private sessions!: SessionStore;
	private _state: EngineState = 'idle';
	private _sessionKey: string = 'main';
	private _abortController: AbortController | null = null;

	private _tokenCount: number = 0;

	get state(): EngineState { return this._state; }
	get sessionKey(): string { return this._sessionKey; }
	get tokenCount(): number { return this._tokenCount; }

	/** Abort the current running request */
	abort(): void {
		if (this._abortController) {
			this._abortController.abort();
			this._abortController = null;
			this.setState('ready');
			this.emit('delta', '');
			this.emit('final', { content: '⏹️ Stopped.', role: 'assistant', timestamp: Date.now() });
			this.log('Request aborted by user');
		}
	}

	async init(config: EngineConfig): Promise<void> {
		this.config = config;

		// Ensure directories exist
		fs.mkdirSync(config.stateDir, { recursive: true });
		fs.mkdirSync(config.workspaceDir, { recursive: true });

		// Initialize LLM client
		this.llm = new LLMClient({
			provider: config.llmProvider,
			apiKey: config.llmApiKey,
			model: config.llmModel,
			ollamaUrl: config.ollamaUrl,
		});

		// Initialize session store
		this.sessions = new SessionStore(config.stateDir);

		this.setState('ready');
		this.log('Engine initialized');
	}

	async sendMessage(text: string, sessionKey?: string, retried?: boolean): Promise<string> {
		const key = sessionKey || this._sessionKey;
		
		if (this._state !== 'ready') {
			throw new Error(`Engine not ready (state: ${this._state})`);
		}

		// Check API key before calling
		if (this.config.llmProvider !== 'ollama' && !this.config.llmApiKey) {
			throw new Error(`No API key configured. Run "SoulClaw: Setup" (Cmd+Shift+P) to set your ${this.config.llmProvider} API key.`);
		}

		this.setState('running');

		try {
			// Add user message to session
			const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
			this.sessions.addMessage(key, userMsg);

			// Build system prompt with tiered bootstrap
			const isContinuation = this.sessions.hasSession(key) && 
				this.sessions.getMessages(key).length > 2; // More than just this message
			
			const allFiles = loadWorkspaceFiles(this.config.workspaceDir);
			const filteredFiles = filterByTier(allFiles, {
				turnCount: isContinuation ? 1 : 0,
			});

			const systemPrompt = buildSystemPrompt({
				bootstrapFiles: filteredFiles,
				sessionKey: key,
				workspaceDir: this.config.workspaceDir,
				model: this.llm.model,
			});

			// Build message history for LLM
			const history = this.sessions.getMessages(key);
			const llmMessages: LLMMessage[] = [
				{ role: 'system', content: systemPrompt },
				...this.truncateHistory(history),
			];

			// Get tools based on provider, filtered by user allowlist
			let tools: any[] | undefined;
			if (this.config.llmProvider !== 'ollama') {
				let allowedTools: string[] | undefined;
				try {
					const vscode = require('vscode');
					allowedTools = vscode.workspace.getConfiguration('clawsouls').get<string[]>('allowedTools');
				} catch {}
				
				const allTools = getAnthropicTools();
				tools = allowedTools
					? allTools.filter((t: any) => allowedTools!.includes(t.name))
					: allTools;
				if (tools.length === 0) tools = undefined;
			}

			// Agentic loop — keep running until we get a text response (not tool calls)
			const MAX_TOOL_ROUNDS = 10;
			let finalText = '';
			this._abortController = new AbortController();
			const signal = this._abortController.signal;

			// Progress notification
			let progressResolve: (() => void) | undefined;
			try {
				const vscode = require('vscode');
				vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: '🔮 SoulClaw thinking...', cancellable: true },
					(_progress: any, token: any) => {
						token.onCancellationRequested(() => this.abort());
						return new Promise<void>(resolve => { progressResolve = resolve; });
					}
				);
			} catch {}

			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				if (signal.aborted) { finalText = '⏹️ Stopped.'; break; }

				this.emit('stateChange', 'running');

				const response = await this.llm.chat(llmMessages, (partialText) => {
					this.emit('delta', partialText);
				}, tools, signal);

				// Check if response contains tool calls
				if (typeof response === 'object' && 'toolCalls' in response) {
					// Execute each tool call
					const toolResults: Array<{ tool_use_id: string; content: string }> = [];
					
					for (const tc of response.toolCalls) {
						if (signal.aborted) break;

						this.log(`Tool call: ${tc.name}(${JSON.stringify(tc.args).slice(0, 200)})`);
						this.emit('toolCall', { name: tc.name, args: tc.args });

						// Check for dangerous commands
						if (tc.name === 'run_command' && this.isDangerousCommand(tc.args.command)) {
							const approved = await this.requestApproval(tc.name, tc.args);
							if (!approved) {
								toolResults.push({
									tool_use_id: tc.id,
									content: 'User denied this command execution.',
								});
								continue;
							}
						}

						this.emit('delta', `🔧 Running ${tc.name}...`);
						
						const projectDir = this.getProjectDir();
						const result = executeTool(
							{ name: tc.name, args: tc.args },
							projectDir
						);
						
						this.log(`Tool result (${result.success ? 'ok' : 'err'}): ${result.output.slice(0, 200)}`);
						this.emit('toolResult', { name: tc.name, success: result.success, output: result.output.slice(0, 500) });

						// Auto-open file after write
						if ((tc.name === 'write_file' || tc.name === 'edit_file') && result.success) {
							this.emit('fileChanged', tc.args.path);
						}

						toolResults.push({
							tool_use_id: tc.id,
							content: result.output,
						});
					}

					// Add assistant tool_use message + tool results to conversation
					llmMessages.push({
						role: 'assistant',
						content: response.toolCalls.map((tc: any) => ({
							type: 'tool_use',
							id: tc.id,
							name: tc.name,
							input: tc.args,
						})) as any,
					});
					llmMessages.push({
						role: 'user',
						content: toolResults.map(tr => ({
							type: 'tool_result',
							tool_use_id: tr.tool_use_id,
							content: tr.content,
						})) as any,
					});

					continue; // Next round
				}

				// Plain text response — we're done
				finalText = response as string;
				break;
			}

			this._abortController = null;
			if (progressResolve) progressResolve();

			// Estimate token usage (rough: 1 token ≈ 4 chars)
			const inputTokens = llmMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0) / 4;
			const outputTokens = finalText.length / 4;
			this._tokenCount += Math.round(inputTokens + outputTokens);
			this.emit('tokenUpdate', this._tokenCount);

			// Persona drift check
			if (finalText) {
				const profile = loadPersonaProfile(this.config.workspaceDir);
				if (profile) {
					const drift = detectDrift(finalText, profile);
					if (drift.drifted) {
						this.log(`⚠️ Persona drift detected (score: ${drift.score}): ${drift.signals.join(', ')}`);
						this.emit('drift', drift);
					}
				}
			}

			// Save assistant response
			const assistantMsg: ChatMessage = { role: 'assistant', content: finalText, timestamp: Date.now() };
			this.sessions.addMessage(key, assistantMsg);

			this.setState('ready');
			this.emit('final', assistantMsg);

			return finalText;
		} catch (err: any) {
			if (progressResolve) progressResolve();
			// Retry once on network/timeout errors
			if (this.isRetryableError(err) && !retried) {
				this.log(`Retryable error, retrying in 2s: ${err.message}`);
				this.emit('delta', '⚠️ Connection error, retrying...');
				await new Promise(r => setTimeout(r, 2000));
				this.setState('ready');
				return this.sendMessage(text, sessionKey, true);
			}
			this.setState('ready');
			this.emit('error', err);
			throw err;
		}
	}

	getHistory(sessionKey?: string, limit?: number): ChatMessage[] {
		const key = sessionKey || this._sessionKey;
		const messages = this.sessions.getMessages(key);
		return limit ? messages.slice(-limit) : messages;
	}

	clearHistory(sessionKey?: string): void {
		const key = sessionKey || this._sessionKey;
		this.sessions.clear(key);
	}

	listSessions(): string[] {
		return this.sessions.listSessions();
	}

	dispose(): void {
		this.setState('idle');
		// NOTE: Do NOT removeAllListeners — chatPanel and statusBar hold persistent listeners.
		// They are registered once in constructor and must survive engine restart.
		this.log('Engine disposed');
	}

	private isDangerousCommand(cmd: string): boolean {
		const dangerous = [
			/\brm\s+-rf?\b/, /\brm\s+/, /\brmdir\b/,
			/\bgit\s+push\b/, /\bgit\s+reset\s+--hard\b/, /\bgit\s+clean\b/,
			/\bsudo\b/, /\bchmod\b/, /\bchown\b/,
			/\bcurl\b.*\|\s*sh/, /\bwget\b.*\|\s*sh/,
			/\bnpm\s+publish\b/, /\bnpx\s/, /\beval\b/,
			/\bdd\s+/, /\bmkfs\b/, /\bformat\b/,
		];
		return dangerous.some(p => p.test(cmd));
	}

	private async requestApproval(toolName: string, args: any): Promise<boolean> {
		try {
			const vscode = require('vscode');
			const detail = toolName === 'run_command' ? args.command : JSON.stringify(args).slice(0, 200);
			const choice = await vscode.window.showWarningMessage(
				`⚠️ SoulClaw wants to execute a potentially dangerous command`,
				{ modal: true, detail: `${detail}\n\nAllow this?` },
				'Allow', 'Deny'
			);
			return choice === 'Allow';
		} catch {
			return false;
		}
	}

	private isRetryableError(err: any): boolean {
		const msg = (err.message || '').toLowerCase();
		return msg.includes('econnreset') || msg.includes('etimedout') ||
			msg.includes('econnrefused') || msg.includes('socket hang up') ||
			msg.includes('529') || msg.includes('overloaded');
	}

	/** Get project directory — prefer VSCode workspace, fallback to engine workspace */
	private getProjectDir(): string {
		try {
			const vscode = require('vscode');
			const ws = vscode.workspace.workspaceFolders;
			if (ws && ws.length > 0) return ws[0].uri.fsPath;
		} catch {}
		return this.config.workspaceDir;
	}

	/**
	 * Truncate and compact conversation history.
	 * If messages exceed limit, summarize older ones into a compact block.
	 */
	private truncateHistory(messages: ChatMessage[], maxMessages?: number): LLMMessage[] {
		let max = maxMessages || 40;
		try {
			const vscode = require('vscode');
			max = vscode.workspace.getConfiguration('clawsouls').get('maxConversationMessages', 40);
		} catch {}

		if (messages.length <= max) {
			return messages.map(m => ({
				role: m.role as 'user' | 'assistant',
				content: m.content,
			}));
		}

		// Compact: summarize first N-max messages, keep last max
		const oldMessages = messages.slice(0, messages.length - max);
		const recentMessages = messages.slice(-max);
		
		const summary = oldMessages.map(m => 
			`[${m.role}]: ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`
		).join('\n');

		const compacted: LLMMessage[] = [
			{ role: 'user', content: `[Previous conversation summary (${oldMessages.length} messages)]\n${summary}` },
			{ role: 'assistant', content: 'Understood, I have the context from our previous conversation.' },
			...recentMessages.map(m => ({
				role: m.role as 'user' | 'assistant',
				content: m.content,
			})),
		];

		return compacted;
	}

	private setState(state: EngineState): void {
		if (this._state !== state) {
			this._state = state;
			this.emit('stateChange', state);
		}
	}

	private log(msg: string): void {
		try {
			const { outputChannel } = require('../extension');
			outputChannel?.appendLine(`[engine] ${msg}`);
		} catch {}
	}
}
