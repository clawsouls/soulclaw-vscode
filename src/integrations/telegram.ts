/**
 * Telegram integration — poll for messages and relay to/from chat.
 */

import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';

interface TelegramConfig {
	botToken: string;
	chatId: string;
}

export class TelegramRelay {
	private config: TelegramConfig | null = null;
	private lastUpdateId = 0;
	private pollInterval: ReturnType<typeof setInterval> | null = null;
	private onMessage: ((text: string, from: string) => void) | null = null;

	constructor(private stateDir: string) {}

	/** Load config from stateDir/config.yaml */
	loadConfig(): boolean {
		try {
			const configPath = path.join(this.stateDir, 'config.yaml');
			const content = fs.readFileSync(configPath, 'utf-8');
			const tokenMatch = content.match(/token:\s*"([^"]+)"/);
			const chatIdMatch = content.match(/allowedChatIds:\s*\n\s*-\s*"([^"]+)"/);
			if (tokenMatch && chatIdMatch) {
				this.config = { botToken: tokenMatch[1], chatId: chatIdMatch[1] };
				return true;
			}
		} catch {}
		return false;
	}

	/** Start polling for messages */
	start(onMessage: (text: string, from: string) => void): void {
		if (!this.config) return;
		this.onMessage = onMessage;
		this.pollInterval = setInterval(() => this.poll(), 5000);
	}

	stop(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

	/** Send a message to Telegram */
	async send(text: string): Promise<boolean> {
		if (!this.config) return false;
		return new Promise((resolve) => {
			const payload = JSON.stringify({
				chat_id: this.config!.chatId,
				text,
				parse_mode: 'Markdown',
			});
			const req = https.request(
				`https://api.telegram.org/bot${this.config!.botToken}/sendMessage`,
				{ method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
				(res) => {
					let d = '';
					res.on('data', (c) => d += c);
					res.on('end', () => resolve(res.statusCode === 200));
				}
			);
			req.on('error', () => resolve(false));
			req.write(payload);
			req.end();
		});
	}

	private poll(): void {
		if (!this.config) return;
		const url = `https://api.telegram.org/bot${this.config.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=1`;
		https.get(url, (res) => {
			let data = '';
			res.on('data', (c) => data += c);
			res.on('end', () => {
				try {
					const parsed = JSON.parse(data);
					if (parsed.ok && parsed.result) {
						for (const update of parsed.result) {
							this.lastUpdateId = update.update_id;
							if (update.message?.text && String(update.message.chat.id) === this.config!.chatId) {
								const from = update.message.from?.first_name || 'User';
								this.onMessage?.(update.message.text, from);
							}
						}
					}
				} catch {}
			});
		}).on('error', () => {});
	}
}
