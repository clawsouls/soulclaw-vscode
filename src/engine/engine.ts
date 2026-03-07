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

	async sendMessage(text: string, sessionKey?: string): Promise<string> {
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

			// Stream response
			this.emit('stateChange', 'running');

			const response = await this.llm.chat(llmMessages, (partialText) => {
				this.emit('delta', partialText);
			});

			// Save assistant response
			const assistantMsg: ChatMessage = { role: 'assistant', content: response, timestamp: Date.now() };
			this.sessions.addMessage(key, assistantMsg);

			this.setState('ready');
			this.emit('final', assistantMsg);

			return response;
		} catch (err: any) {
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
		this.removeAllListeners();
		this.log('Engine disposed');
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
