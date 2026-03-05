import * as vscode from 'vscode';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');

function log(msg: string) {
	try {
		const { outputChannel } = require('../extension');
		outputChannel?.appendLine(msg);
	} catch {}
	console.log(msg);
}

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export interface GatewayMessage {
	type: string;
	data?: any;
	event?: string;
	payload?: any;
	id?: string;
	ok?: boolean;
	error?: any;
	method?: string;
	params?: any;
	seq?: number;
}

export class GatewayConnection {
	private ws: any = null;
	private state: ConnectionState = 'idle';
	private readonly onStateChangedEmitter = new vscode.EventEmitter<ConnectionState>();
	private readonly onMessageEmitter = new vscode.EventEmitter<GatewayMessage>();
	private reconnectTimer: NodeJS.Timeout | null = null;
	private pingTimer: NodeJS.Timeout | null = null;
	private pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	
	public readonly onStateChanged = this.onStateChangedEmitter.event;
	public readonly onMessage = this.onMessageEmitter.event;
	
	constructor(private context: vscode.ExtensionContext) {
		this.context.subscriptions.push(
			this.onStateChangedEmitter,
			this.onMessageEmitter
		);
	}
	
	public get currentState(): ConnectionState {
		return this.state;
	}
	
	private token: string = '';

	public setToken(token: string): void {
		this.token = token;
	}

	public async connect(): Promise<void> {
		if (this.state === 'connecting' || this.state === 'connected') {
			return;
		}
		
		this.setState('connecting');
		
		try {
			const baseUrl = vscode.workspace.getConfiguration('clawsouls').get('gatewayUrl', 'ws://127.0.0.1:18789');
			
			log(`WS connecting to: ${baseUrl} (token: ${this.token ? 'yes' : 'no'})`);
			
			this.ws = new WebSocket(baseUrl);
			
			this.ws.on('open', () => {
				log('WebSocket open — waiting for connect.challenge...');
			});
			
			this.ws.on('message', (data: Buffer) => {
				try {
					const msg = JSON.parse(data.toString());
					this.handleFrame(msg);
				} catch (error) {
					log(`Failed to parse Gateway message: ${error}`);
				}
			});
			
			this.ws.on('close', (code: number, reason: Buffer) => {
				log(`WebSocket closed: code=${code} reason=${reason?.toString()}`);
				this.setState('disconnected');
				this.stopPing();
				this.rejectAll(new Error(`WebSocket closed: ${code}`));
				this.scheduleReconnect();
			});
			
			this.ws.on('error', (error: Error) => {
				log(`WebSocket error: ${error.message}`);
				this.setState('error');
				this.stopPing();
				this.rejectAll(error);
				this.scheduleReconnect();
			});
			
		} catch (error: any) {
			log(`Failed to connect to Gateway: ${error?.message || error}`);
			this.setState('error');
			this.scheduleReconnect();
		}
	}

	private handleFrame(msg: any): void {
		if (msg.type === 'event') {
			if (msg.event === 'connect.challenge') {
				const nonce = msg.payload?.nonce;
				log(`Got connect.challenge (nonce: ${nonce ? 'yes' : 'no'})`);
				this.sendConnectRequest(nonce);
				return;
			}
			// Log all events for debugging
			log(`Event: ${msg.event} state=${msg.payload?.state || '-'}`);
			// Forward other events
			this.onMessageEmitter.fire(msg);
			return;
		}

		if (msg.type === 'res') {
			const pending = this.pendingRequests.get(msg.id);
			if (pending) {
				this.pendingRequests.delete(msg.id);
				if (msg.ok) {
					pending.resolve(msg.payload);
				} else {
					pending.reject(new Error(msg.error?.message || 'Request failed'));
				}
			}
			return;
		}

		// Forward anything else
		this.onMessageEmitter.fire(msg);
	}

	private _sessionKey: string = 'main';
	public get sessionKey(): string { return this._sessionKey; }

	private async sendConnectRequest(nonce?: string): Promise<void> {
		const params: any = {
			minProtocol: 3,
			maxProtocol: 3,
			client: {
				id: 'gateway-client',
				displayName: 'ClawSouls Agent (VSCode)',
				version: '0.1.0',
				platform: process.platform,
				mode: 'ui'
			},
			caps: [],
			auth: this.token ? { token: this.token } : undefined,
			role: 'operator',
			scopes: ['operator.admin']
		};

		try {
			const hello = await this.request('connect', params);
			// Extract session key from hello snapshot
			const defaults = hello?.snapshot?.sessionDefaults;
			if (defaults?.mainSessionKey) {
				this._sessionKey = defaults.mainSessionKey;
			}
			log(`Connected! sessionKey=${this._sessionKey}`);
			this.setState('connected');
			this.startPing();
		} catch (err: any) {
			log(`Connect request failed: ${err.message}`);
			this.ws?.close(1008, 'connect failed');
		}
	}

	private request(method: string, params?: any): Promise<any> {
		return new Promise((resolve, reject) => {
			if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
				reject(new Error('WebSocket not open'));
				return;
			}
			const id = crypto.randomUUID();
			const frame = {
				type: 'req',
				id,
				method,
				params
			};
			this.pendingRequests.set(id, { resolve, reject });
			this.ws.send(JSON.stringify(frame));
		});
	}

	private rejectAll(err: Error): void {
		for (const [, p] of this.pendingRequests) {
			p.reject(err);
		}
		this.pendingRequests.clear();
	}

	public disconnect(): void {
		this.clearReconnectTimer();
		this.stopPing();
		this.rejectAll(new Error('Disconnected'));
		
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		
		this.setState('idle');
	}
	
	public async restart(): Promise<void> {
		vscode.window.showInformationMessage('Restarting Gateway...');
		this.disconnect();
		await new Promise(resolve => setTimeout(resolve, 1000));
		await this.connect();
	}
	
	public sendMessage(message: GatewayMessage): void {
		if (this.ws && this.state === 'connected') {
			this.ws.send(JSON.stringify(message));
		} else {
			log('Cannot send message: Gateway not connected');
			vscode.window.showWarningMessage('Gateway not connected. Trying to reconnect...');
			this.connect();
		}
	}

	/** Generic RPC request */
	public async requestRPC(method: string, params?: any): Promise<any> {
		return this.request(method, params);
	}

	/** Send a chat message to the gateway */
	public async sendChat(text: string, sessionKey?: string): Promise<any> {
		const key = sessionKey || this._sessionKey;
		const idempotencyKey = crypto.randomUUID();
		log(`chat.send → sessionKey=${key}, msg=${text.slice(0, 50)}`);
		return this.request('chat.send', {
			sessionKey: key,
			message: text,
			idempotencyKey,
			deliver: false
		});
	}
	
	private setState(newState: ConnectionState): void {
		if (this.state !== newState) {
			this.state = newState;
			this.onStateChangedEmitter.fire(newState);
		}
	}
	
	private scheduleReconnect(): void {
		this.clearReconnectTimer();
		
		const config = vscode.workspace.getConfiguration('clawsouls');
		if (config.get('autoConnect', true)) {
			this.reconnectTimer = setTimeout(() => {
				if (this.state !== 'connected') {
					log('Attempting to reconnect to Gateway...');
					this.connect();
				}
			}, 5000);
		}
	}
	
	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
	
	private startPing(): void {
		this.pingTimer = setInterval(() => {
			if (this.ws && this.state === 'connected') {
				this.ws.ping();
			}
		}, 30000);
	}
	
	private stopPing(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}
}
