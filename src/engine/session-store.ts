/**
 * Simple JSON-based session persistence.
 * Stores conversation history per session key.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ChatMessage } from './types';

const MAX_MESSAGES = 200;

export class SessionStore {
	private sessionsDir: string;

	constructor(stateDir: string) {
		this.sessionsDir = path.join(stateDir, 'sessions');
		fs.mkdirSync(this.sessionsDir, { recursive: true });
	}

	private sessionPath(sessionKey: string): string {
		const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
		return path.join(this.sessionsDir, `${safe}.json`);
	}

	getMessages(sessionKey: string): ChatMessage[] {
		try {
			const data = fs.readFileSync(this.sessionPath(sessionKey), 'utf-8');
			const messages = JSON.parse(data);
			return Array.isArray(messages) ? messages : [];
		} catch {
			return [];
		}
	}

	addMessage(sessionKey: string, message: ChatMessage): void {
		const messages = this.getMessages(sessionKey);
		messages.push(message);

		// Keep bounded
		const trimmed = messages.length > MAX_MESSAGES
			? messages.slice(-MAX_MESSAGES)
			: messages;

		fs.writeFileSync(this.sessionPath(sessionKey), JSON.stringify(trimmed, null, 2));
	}

	clear(sessionKey: string): void {
		try {
			fs.unlinkSync(this.sessionPath(sessionKey));
		} catch {}
	}

	hasSession(sessionKey: string): boolean {
		return fs.existsSync(this.sessionPath(sessionKey));
	}

	clearAll(): void {
		try {
			const files = fs.readdirSync(this.sessionsDir).filter(f => f.endsWith('.json'));
			for (const f of files) {
				fs.unlinkSync(path.join(this.sessionsDir, f));
			}
		} catch {}
	}

	listSessions(): string[] {
		try {
			return fs.readdirSync(this.sessionsDir)
				.filter(f => f.endsWith('.json'))
				.map(f => f.replace('.json', ''));
		} catch {
			return [];
		}
	}
}
