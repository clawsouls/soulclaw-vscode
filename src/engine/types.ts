export type EngineState = 'idle' | 'ready' | 'running' | 'error';

export interface EngineConfig {
	stateDir: string;
	workspaceDir: string;
	llmProvider: 'anthropic' | 'openai' | 'ollama';
	llmApiKey?: string;
	llmModel?: string;
	ollamaUrl?: string;
	ollamaModel?: string;
}

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
}

export interface BootstrapFile {
	name: string;
	path: string;
	content?: string;
	missing: boolean;
}

export type BootstrapTier = 1 | 2 | 3;
