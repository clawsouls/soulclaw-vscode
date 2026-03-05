import * as vscode from 'vscode';
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
	sessionId?: string;
	timestamp?: number;
}

export class GatewayConnection {
	private ws: WebSocket | null = null;
	private state: ConnectionState = 'idle';
	private readonly onStateChangedEmitter = new vscode.EventEmitter<ConnectionState>();
	private readonly onMessageEmitter = new vscode.EventEmitter<GatewayMessage>();
	private reconnectTimer: NodeJS.Timeout | null = null;
	private pingTimer: NodeJS.Timeout | null = null;
	
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
			const sep = baseUrl.includes('?') ? '&' : '?';
			const gatewayUrl = this.token ? `${baseUrl}${sep}auth=${this.token}` : baseUrl;
			
			log(`WS connecting to: ${baseUrl} (token: ${this.token ? 'yes' : 'no'})`);
			
			this.ws = new WebSocket(gatewayUrl);
			
			this.ws.on('open', () => {
				log('WebSocket connected!');
				this.setState('connected');
				this.startPing();
				
				// Send initial handshake
				this.sendMessage({
					type: 'handshake',
					data: {
						client: 'clawsouls-vscode',
						version: '0.1.0'
					}
				});
			});
			
			this.ws.on('message', (data) => {
				try {
					const message: GatewayMessage = JSON.parse(data.toString());
					this.onMessageEmitter.fire(message);
				} catch (error) {
					console.error('Failed to parse Gateway message:', error);
				}
			});
			
			this.ws.on('close', (code: number, reason: Buffer) => {
				log(`WebSocket closed: code=${code} reason=${reason?.toString()}`);
				this.setState('disconnected');
				this.stopPing();
				this.scheduleReconnect();
			});
			
			this.ws.on('error', (error: Error) => {
				log(`WebSocket error: ${error.message}`);
				this.setState('error');
				this.stopPing();
				this.scheduleReconnect();
			});
			
		} catch (error: any) {
			log(`Failed to connect to Gateway: ${error?.message || error}`);
			this.setState('error');
			this.scheduleReconnect();
		}
	}
	
	public disconnect(): void {
		this.clearReconnectTimer();
		this.stopPing();
		
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		
		this.setState('idle');
	}
	
	public async restart(): Promise<void> {
		vscode.window.showInformationMessage('Restarting Gateway...');
		
		this.disconnect();
		
		// Give it a moment to clean up
		await new Promise(resolve => setTimeout(resolve, 1000));
		
		await this.connect();
	}
	
	public sendMessage(message: GatewayMessage): void {
		if (this.ws && this.state === 'connected') {
			const messageWithTimestamp = {
				...message,
				timestamp: Date.now()
			};
			this.ws.send(JSON.stringify(messageWithTimestamp));
		} else {
			console.warn('Cannot send message: Gateway not connected');
			vscode.window.showWarningMessage('Gateway not connected. Trying to reconnect...');
			this.connect();
		}
	}
	
	private setState(newState: ConnectionState): void {
		if (this.state !== newState) {
			this.state = newState;
			this.onStateChangedEmitter.fire(newState);
		}
	}
	
	private scheduleReconnect(): void {
		this.clearReconnectTimer();
		
		// Only auto-reconnect if autoConnect is enabled
		const config = vscode.workspace.getConfiguration('clawsouls');
		if (config.get('autoConnect', true)) {
			this.reconnectTimer = setTimeout(() => {
				if (this.state !== 'connected') {
					console.log('Attempting to reconnect to Gateway...');
					this.connect();
				}
			}, 5000); // Retry every 5 seconds
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
		}, 30000); // Ping every 30 seconds
	}
	
	private stopPing(): void {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}
}