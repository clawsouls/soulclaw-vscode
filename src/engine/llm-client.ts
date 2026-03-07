/**
 * Direct LLM API client — no gateway intermediary.
 * Supports Anthropic, OpenAI, and Ollama.
 */

import * as https from 'https';
import * as http from 'http';
import { EventEmitter } from 'events';

export interface LLMClientConfig {
	provider: 'anthropic' | 'openai' | 'ollama';
	apiKey?: string;
	model?: string;
	ollamaUrl?: string;
}

export interface LLMMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface LLMStreamEvent {
	type: 'delta' | 'done' | 'error';
	text?: string;
	error?: string;
	fullText?: string;
}

const DEFAULT_MODELS: Record<string, string> = {
	anthropic: 'claude-sonnet-4-20250514',
	openai: 'gpt-4o',
	ollama: 'llama3.2',
};

export class LLMClient extends EventEmitter {
	private config: LLMClientConfig;

	constructor(config: LLMClientConfig) {
		super();
		this.config = config;
	}

	get model(): string {
		return this.config.model || DEFAULT_MODELS[this.config.provider] || 'claude-sonnet-4-20250514';
	}

	async chat(messages: LLMMessage[], onDelta?: (text: string) => void): Promise<string> {
		switch (this.config.provider) {
			case 'anthropic':
				return this.chatAnthropic(messages, onDelta);
			case 'openai':
				return this.chatOpenAI(messages, onDelta);
			case 'ollama':
				return this.chatOllama(messages, onDelta);
			default:
				throw new Error(`Unknown provider: ${this.config.provider}`);
		}
	}

	private async chatAnthropic(messages: LLMMessage[], onDelta?: (text: string) => void): Promise<string> {
		const systemMsg = messages.find(m => m.role === 'system');
		const chatMsgs = messages.filter(m => m.role !== 'system');

		const body = JSON.stringify({
			model: this.model,
			max_tokens: 8192,
			system: systemMsg?.content || '',
			messages: chatMsgs.map(m => ({ role: m.role, content: m.content })),
			stream: true,
		});

		return new Promise((resolve, reject) => {
			const req = https.request({
				hostname: 'api.anthropic.com',
				path: '/v1/messages',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.config.apiKey || '',
					'anthropic-version': '2023-06-01',
				},
			}, (res) => {
				if (res.statusCode && res.statusCode >= 400) {
					let errBody = '';
					res.on('data', (chunk) => errBody += chunk);
					res.on('end', () => reject(new Error(`Anthropic API ${res.statusCode}: ${errBody}`)));
					return;
				}

				let fullText = '';
				let buffer = '';

				res.on('data', (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.startsWith('data: ')) continue;
						const data = line.slice(6).trim();
						if (data === '[DONE]') continue;

						try {
							const event = JSON.parse(data);
							if (event.type === 'content_block_delta' && event.delta?.text) {
								fullText += event.delta.text;
								onDelta?.(fullText);
							}
						} catch {}
					}
				});

				res.on('end', () => resolve(fullText));
			});

			req.on('error', reject);
			req.write(body);
			req.end();
		});
	}

	private async chatOpenAI(messages: LLMMessage[], onDelta?: (text: string) => void): Promise<string> {
		const body = JSON.stringify({
			model: this.model,
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			stream: true,
		});

		return new Promise((resolve, reject) => {
			const req = https.request({
				hostname: 'api.openai.com',
				path: '/v1/chat/completions',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.config.apiKey || ''}`,
				},
			}, (res) => {
				if (res.statusCode && res.statusCode >= 400) {
					let errBody = '';
					res.on('data', (chunk) => errBody += chunk);
					res.on('end', () => reject(new Error(`OpenAI API ${res.statusCode}: ${errBody}`)));
					return;
				}

				let fullText = '';
				let buffer = '';

				res.on('data', (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.startsWith('data: ')) continue;
						const data = line.slice(6).trim();
						if (data === '[DONE]') continue;

						try {
							const event = JSON.parse(data);
							const delta = event.choices?.[0]?.delta?.content;
							if (delta) {
								fullText += delta;
								onDelta?.(fullText);
							}
						} catch {}
					}
				});

				res.on('end', () => resolve(fullText));
			});

			req.on('error', reject);
			req.write(body);
			req.end();
		});
	}

	private async chatOllama(messages: LLMMessage[], onDelta?: (text: string) => void): Promise<string> {
		const baseUrl = this.config.ollamaUrl || 'http://127.0.0.1:11434';
		const url = new URL('/api/chat', baseUrl);

		const body = JSON.stringify({
			model: this.model,
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			stream: true,
		});

		const transport = url.protocol === 'https:' ? https : http;

		return new Promise((resolve, reject) => {
			const req = transport.request({
				hostname: url.hostname,
				port: url.port,
				path: url.pathname,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			}, (res) => {
				if (res.statusCode && res.statusCode >= 400) {
					let errBody = '';
					res.on('data', (chunk) => errBody += chunk);
					res.on('end', () => reject(new Error(`Ollama API ${res.statusCode}: ${errBody}`)));
					return;
				}

				let fullText = '';
				let buffer = '';

				res.on('data', (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const event = JSON.parse(line);
							if (event.message?.content) {
								fullText += event.message.content;
								onDelta?.(fullText);
							}
						} catch {}
					}
				});

				res.on('end', () => resolve(fullText));
			});

			req.on('error', reject);
			req.write(body);
			req.end();
		});
	}
}
