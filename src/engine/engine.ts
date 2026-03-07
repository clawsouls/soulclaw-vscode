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

export class SoulClawEngine extends EventEmitter {
	private config!: EngineConfig;
	private llm!: LLMClient;
	private sessions!: SessionStore;
	private _state: EngineState = 'idle';
	private _sessionKey: string = 'main';

	get state(): EngineState { return this._state; }
	get sessionKey(): string { return this._sessionKey; }

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

			// Get tools based on provider
			const tools = this.config.llmProvider === 'anthropic' ? getAnthropicTools() : undefined;

			// Agentic loop — keep running until we get a text response (not tool calls)
			const MAX_TOOL_ROUNDS = 10;
			let finalText = '';

			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				this.emit('stateChange', 'running');

				const response = await this.llm.chat(llmMessages, (partialText) => {
					this.emit('delta', partialText);
				}, tools);

				// Check if response contains tool calls
				if (typeof response === 'object' && 'toolCalls' in response) {
					// Execute each tool call
					const toolResults: Array<{ tool_use_id: string; content: string }> = [];
					
					for (const tc of response.toolCalls) {
						this.log(`Tool call: ${tc.name}(${JSON.stringify(tc.args).slice(0, 200)})`);
						this.emit('delta', `🔧 Running ${tc.name}...`);
						
						const projectDir = this.getProjectDir();
						const result = executeTool(
							{ name: tc.name, args: tc.args },
							projectDir
						);
						
						this.log(`Tool result (${result.success ? 'ok' : 'err'}): ${result.output.slice(0, 200)}`);
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

			// Save assistant response
			const assistantMsg: ChatMessage = { role: 'assistant', content: finalText, timestamp: Date.now() };
			this.sessions.addMessage(key, assistantMsg);

			this.setState('ready');
			this.emit('final', assistantMsg);

			return finalText;
		} catch (err: any) {
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
	 * Truncate conversation history to fit context window.
	 * Keep last N messages, prioritize recent context.
	 */
	private truncateHistory(messages: ChatMessage[], maxMessages: number = 40): LLMMessage[] {
		const recent = messages.slice(-maxMessages);
		return recent.map(m => ({
			role: m.role as 'user' | 'assistant',
			content: m.content,
		}));
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
