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

	async chat(messages: LLMMessage[], onDelta?: (text: string) => void, tools?: any[], signal?: AbortSignal): Promise<string | { toolCalls: Array<{ id: string; name: string; args: any }> }> {
		switch (this.config.provider) {
			case 'anthropic':
				return this.chatAnthropic(messages, onDelta, tools, signal);
			case 'openai':
				return this.chatOpenAI(messages, onDelta, tools, signal);
			case 'ollama':
				return this.chatOllama(messages, onDelta, signal);
			default:
				throw new Error(`Unknown provider: ${this.config.provider}`);
		}
	}

	private async chatAnthropic(messages: LLMMessage[], onDelta?: (text: string) => void, tools?: any[], signal?: AbortSignal): Promise<string | { toolCalls: Array<{ id: string; name: string; args: any }> }> {
		const systemMsg = messages.find(m => m.role === 'system');
		const chatMsgs = messages.filter(m => m.role !== 'system');

		// Use prompt caching for system prompt (Anthropic beta)
		const systemContent = systemMsg?.content || '';
		const payload: any = {
			model: this.model,
			max_tokens: 8192,
			system: [{ type: 'text', text: systemContent, cache_control: { type: 'ephemeral' } }],
			messages: chatMsgs.map(m => {
				if (typeof m.content === 'string') return { role: m.role, content: m.content };
				return { role: m.role, content: m.content };
			}),
			stream: true,
		};
		if (tools && tools.length > 0) {
			payload.tools = tools;
		}
		const body = JSON.stringify(payload);

		return new Promise((resolve, reject) => {
			const req = https.request({
				hostname: 'api.anthropic.com',
				path: '/v1/messages',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.config.apiKey || '',
					'anthropic-version': '2023-06-01',
					'anthropic-beta': 'prompt-caching-2024-07-31',
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
				const toolCalls: Array<{ id: string; name: string; args: string }> = [];
				let currentToolIndex = -1;

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
							if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
								currentToolIndex++;
								toolCalls.push({
									id: event.content_block.id,
									name: event.content_block.name,
									args: '',
								});
							} else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
								if (currentToolIndex >= 0 && toolCalls[currentToolIndex]) {
									toolCalls[currentToolIndex].args += event.delta.partial_json;
								}
							} else if (event.type === 'content_block_delta' && event.delta?.text) {
								fullText += event.delta.text;
								onDelta?.(fullText);
							}
						} catch {}
					}
				});

				res.on('end', () => {
					if (toolCalls.length > 0) {
						const parsed = toolCalls.map(tc => ({
							id: tc.id,
							name: tc.name,
							args: (() => { try { return JSON.parse(tc.args); } catch { return {}; } })(),
						}));
						resolve({ toolCalls: parsed } as any);
					} else {
						resolve(fullText);
					}
				});
			});

			req.on('error', (err) => {
				if ((err as any).code === 'ABORT_ERR' || signal?.aborted) {
					resolve(fullText || '⏹️ Stopped.');
				} else {
					reject(err);
				}
			});
			if (signal) {
				signal.addEventListener('abort', () => req.destroy(), { once: true });
			}
			req.write(body);
			req.end();
		});
	}

	private async chatOpenAI(messages: LLMMessage[], onDelta?: (text: string) => void, tools?: any[], signal?: AbortSignal): Promise<string | { toolCalls: Array<{ id: string; name: string; args: any }> }> {
		const payload: any = {
			model: this.model,
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			stream: true,
		};
		if (tools && tools.length > 0) {
			payload.tools = tools;
		}
		const body = JSON.stringify(payload);

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
				const openaiToolCalls: Array<{ id: string; name: string; args: string }> = [];

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
							const choice = event.choices?.[0];
							const delta = choice?.delta;
							
							// Text content
							if (delta?.content) {
								fullText += delta.content;
								onDelta?.(fullText);
							}

							// Tool calls
							if (delta?.tool_calls) {
								for (const tc of delta.tool_calls) {
									if (tc.index !== undefined) {
										while (openaiToolCalls.length <= tc.index) {
											openaiToolCalls.push({ id: '', name: '', args: '' });
										}
										if (tc.id) openaiToolCalls[tc.index].id = tc.id;
										if (tc.function?.name) openaiToolCalls[tc.index].name = tc.function.name;
										if (tc.function?.arguments) openaiToolCalls[tc.index].args += tc.function.arguments;
									}
								}
							}
						} catch {}
					}
				});

				res.on('end', () => {
					if (openaiToolCalls.length > 0 && openaiToolCalls[0].name) {
						const parsed = openaiToolCalls.map(tc => ({
							id: tc.id,
							name: tc.name,
							args: (() => { try { return JSON.parse(tc.args); } catch { return {}; } })(),
						}));
						resolve({ toolCalls: parsed } as any);
					} else {
						resolve(fullText);
					}
				});
			});

			req.on('error', (err) => {
				if ((err as any).code === 'ABORT_ERR' || signal?.aborted) {
					resolve(fullText || '⏹️ Stopped.');
				} else {
					reject(err);
				}
			});
			if (signal) {
				signal.addEventListener('abort', () => req.destroy(), { once: true });
			}
			req.write(body);
			req.end();
		});
	}

	private async chatOllama(messages: LLMMessage[], onDelta?: (text: string) => void, signal?: AbortSignal, tools?: any[]): Promise<string | { toolCalls: Array<{ id: string; name: string; args: any }> }> {
		const baseUrl = this.config.ollamaUrl || 'http://127.0.0.1:11434';
		const url = new URL('/api/chat', baseUrl);

		const payload: any = {
			model: this.model,
			messages: messages.map(m => ({ role: m.role, content: m.content })),
			stream: true,
		};
		// Ollama tool calling (supported by llama3.1+, mistral, etc.)
		if (tools && tools.length > 0) {
			payload.tools = tools.map((t: any) => ({
				type: 'function',
				function: { name: t.name, description: t.description, parameters: t.input_schema || t.parameters },
			}));
		}
		const body = JSON.stringify(payload);

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
				const ollamaToolCalls: Array<{ id: string; name: string; args: any }> = [];

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
							// Ollama tool calls
							if (event.message?.tool_calls) {
								for (const tc of event.message.tool_calls) {
									ollamaToolCalls.push({
										id: `ollama_${Date.now()}_${ollamaToolCalls.length}`,
										name: tc.function?.name || '',
										args: tc.function?.arguments || {},
									});
								}
							}
						} catch {}
					}
				});

				res.on('end', () => {
					if (ollamaToolCalls.length > 0) {
						resolve({ toolCalls: ollamaToolCalls } as any);
					} else {
						resolve(fullText);
					}
				});
			});

			req.on('error', (err) => {
				if ((err as any).code === 'ABORT_ERR' || signal?.aborted) {
					resolve(fullText || '⏹️ Stopped.');
				} else {
					reject(err);
				}
			});
			if (signal) {
				signal.addEventListener('abort', () => req.destroy(), { once: true });
			}
			req.write(body);
			req.end();
		});
	}
}
