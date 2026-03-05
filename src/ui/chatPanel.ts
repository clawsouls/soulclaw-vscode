import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { marked } from 'marked';
import { GatewayConnection, GatewayMessage } from '../gateway/connection';
import { workspaceTracker } from '../extension';

export class ChatPanel {
	private panel: vscode.WebviewPanel | null = null;
	private messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> = [];
	
	constructor(
		private context: vscode.ExtensionContext,
		private gateway: GatewayConnection
	) {
		// Listen for Gateway messages
		this.gateway.onMessage(this.handleGatewayMessage.bind(this));
	}
	
	public show(): void {
		if (this.panel) {
			this.panel.reveal();
			return;
		}
		
		this.panel = vscode.window.createWebviewPanel(
			'clawsoulsChat',
			'ClawSouls Chat',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, 'media')
				]
			}
		);
		
		this.panel.onDidDispose(() => {
			this.panel = null;
		});
		
		this.panel.webview.onDidReceiveMessage(this.handleWebviewMessage.bind(this));
		
		this.updateWebviewContent();
	}
	
	public addMessage(role: 'user' | 'assistant', content: string): void {
		this.messages.push({
			role,
			content,
			timestamp: Date.now()
		});
		
		if (this.panel) {
			// Clear streaming indicator before updating
			if (role === 'assistant') {
				this.panel.webview.postMessage({ type: 'clearStream' });
			}
			this.updateWebviewContent();
		}
	}
	
	private handleWebviewMessage(message: any): void {
		switch (message.type) {
			case 'sendMessage':
				this.sendMessageToAgent(message.text);
				break;
			case 'insertFile':
				this.insertFileIntoChat(message.path);
				break;
		}
	}
	
	private currentRunId: string | null = null;
	private streamBuffer: string = '';

	private handleGatewayMessage(message: GatewayMessage): void {
		// Handle chat events from gateway
		if (message.type === 'event' && message.event === 'chat') {
			const payload = message.payload as any;
			if (!payload) return;

			const state = payload.state;
			if (state === 'delta') {
				// Streaming delta — extract text from message
				const text = this.extractText(payload.message);
				if (text) {
					this.streamBuffer = text;
					this.updateStreamingMessage();
				}
			} else if (state === 'final') {
				// Final — fetch full chat history to get the actual response
				this.streamBuffer = '';
				this.currentRunId = null;
				this.fetchLatestResponse();
			} else if (state === 'error') {
				this.streamBuffer = '';
				this.currentRunId = null;
				this.addMessage('assistant', `Error: ${payload.errorMessage || 'unknown error'}`);
			} else if (state === 'aborted') {
				this.streamBuffer = '';
				this.currentRunId = null;
				this.addMessage('assistant', '(aborted)');
			}
		}
	}

	private async fetchLatestResponse(): Promise<void> {
		try {
			const history = await this.gateway.requestRPC('chat.history', {
				sessionKey: this.gateway.sessionKey,
				limit: 10
			});
			// Debug: log raw history response
			const { outputChannel } = require('../extension');
			outputChannel?.appendLine(`chat.history response keys: ${JSON.stringify(Object.keys(history || {}))}`);
			
			const messages = history?.messages;
			outputChannel?.appendLine(`messages count: ${Array.isArray(messages) ? messages.length : 'not array'}`);
			
			if (Array.isArray(messages) && messages.length > 0) {
				const last = messages[messages.length - 1];
				outputChannel?.appendLine(`last msg: role=${last?.role} content_type=${typeof last?.content} content=${JSON.stringify(last?.content)?.slice(0, 200)}`);
				
				// Find last assistant message
				for (let i = messages.length - 1; i >= 0; i--) {
					const msg = messages[i];
					if (msg.role === 'assistant') {
						const text = this.extractText(msg);
						outputChannel?.appendLine(`extractText result: ${text?.slice(0, 100) || 'null'}`);
						if (text) {
							this.addMessage('assistant', text);
							return;
						}
					}
				}
			}
			this.addMessage('assistant', '(no response)');
		} catch (err: any) {
			const { outputChannel } = require('../extension');
			outputChannel?.appendLine(`chat.history error: ${err.message}`);
			this.addMessage('assistant', `(failed to fetch: ${err.message})`);
		}
	}

	private extractText(message: any): string | null {
		if (!message) return null;
		const content = message.content;
		if (typeof content === 'string') return content;
		if (Array.isArray(content)) {
			return content
				.filter((b: any) => b.type === 'text' && typeof b.text === 'string')
				.map((b: any) => b.text)
				.join('\n') || null;
		}
		return null;
	}

	private updateStreamingMessage(): void {
		if (this.panel) {
			this.panel.webview.postMessage({
				type: 'streamUpdate',
				text: this.streamBuffer
			});
		}
	}

	private async sendMessageToAgent(text: string): Promise<void> {
		// Add user message to chat
		this.addMessage('user', text);

		// Generate idempotency key
		const idempotencyKey = crypto.randomUUID();
		this.currentRunId = idempotencyKey;
		this.streamBuffer = '';

		// Send via chat.send RPC
		try {
			await this.gateway.sendChat(text, undefined);
		} catch (err: any) {
			this.addMessage('assistant', `Failed to send: ${err.message}`);
		}
	}
	
	private insertFileIntoChat(filePath: string): void {
		if (this.panel) {
			this.panel.webview.postMessage({
				type: 'insertText',
				text: `📁 ${filePath}`
			});
		}
	}
	
	private updateWebviewContent(): void {
		if (!this.panel) return;
		
		const messagesHtml = this.messages.map(msg => {
			const time = new Date(msg.timestamp).toLocaleTimeString();
			const content = marked.parse(msg.content, { async: false }) as string;
			const roleClass = msg.role === 'user' ? 'user-message' : 'assistant-message';
			const roleIcon = msg.role === 'user' ? '👤' : '🔮';
			
			return `
				<div class="message ${roleClass}">
					<div class="message-header">
						<span class="role-icon">${roleIcon}</span>
						<span class="timestamp">${time}</span>
					</div>
					<div class="message-content">${content}</div>
				</div>
			`;
		}).join('');
		
		const gatewayStatus = this.gateway.currentState;
		const statusColor = this.getStatusColor(gatewayStatus);
		
		this.panel.webview.html = `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>ClawSouls Chat</title>
				<link rel="stylesheet" href="${this.getMediaUri('chat.css')}">
			</head>
			<body>
				<div class="header">
					<div class="status">
						<span class="status-indicator" style="background-color: ${statusColor}"></span>
						Gateway: ${gatewayStatus}
					</div>
				</div>
				
				<div class="messages" id="messages">
					${messagesHtml}
				</div>
				
				<div class="input-area">
					<div class="input-container">
						<textarea id="messageInput" placeholder="Send a message to your soul-powered agent..."
								  rows="2" maxlength="4000"></textarea>
						<button id="sendButton">Send</button>
					</div>
					<div class="drag-drop-area" id="dragDropArea">
						📁 Drag & drop files here to insert paths
					</div>
				</div>
				
				<script>
					const vscode = acquireVsCodeApi();
					const messageInput = document.getElementById('messageInput');
					const sendButton = document.getElementById('sendButton');
					const messagesContainer = document.getElementById('messages');
					const dragDropArea = document.getElementById('dragDropArea');
					
					// Send message
					function sendMessage() {
						const text = messageInput.value.trim();
						if (text) {
							vscode.postMessage({
								type: 'sendMessage',
								text: text
							});
							messageInput.value = '';
						}
					}
					
					sendButton.addEventListener('click', sendMessage);
					
					messageInput.addEventListener('keydown', (e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							sendMessage();
						}
					});
					
					// Auto-scroll to bottom
					messagesContainer.scrollTop = messagesContainer.scrollHeight;
					
					// Drag & drop for files
					dragDropArea.addEventListener('dragover', (e) => {
						e.preventDefault();
						dragDropArea.classList.add('drag-over');
					});
					
					dragDropArea.addEventListener('dragleave', () => {
						dragDropArea.classList.remove('drag-over');
					});
					
					dragDropArea.addEventListener('drop', (e) => {
						e.preventDefault();
						dragDropArea.classList.remove('drag-over');
						
						const files = e.dataTransfer.files;
						if (files.length > 0) {
							vscode.postMessage({
								type: 'insertFile',
								path: files[0].path
							});
						}
					});
					
					// Listen for messages from extension
					window.addEventListener('message', (event) => {
						const message = event.data;
						if (message.type === 'insertText') {
							messageInput.value += message.text;
						}
						if (message.type === 'streamUpdate') {
							// Show streaming response
							let streamEl = document.getElementById('streaming');
							if (!streamEl) {
								streamEl = document.createElement('div');
								streamEl.id = 'streaming';
								streamEl.className = 'message assistant-message';
								streamEl.innerHTML = '<div class="message-header"><span class="role-icon">🔮</span><span class="timestamp">typing...</span></div><div class="message-content" id="stream-content"></div>';
								messagesContainer.appendChild(streamEl);
							}
							const contentEl = document.getElementById('stream-content');
							if (contentEl) contentEl.textContent = message.text;
							messagesContainer.scrollTop = messagesContainer.scrollHeight;
						}
						if (message.type === 'clearStream') {
							const streamEl = document.getElementById('streaming');
							if (streamEl) streamEl.remove();
						}
					});
				</script>
			</body>
			</html>
		`;
	}
	
	private getStatusColor(status: string): string {
		switch (status) {
			case 'connected': return '#00ff00';
			case 'connecting': return '#ffff00';
			case 'error': return '#ff0000';
			default: return '#888888';
		}
	}
	
	private getMediaUri(fileName: string): vscode.Uri {
		return this.panel!.webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', fileName)
		);
	}
	
	public dispose(): void {
		if (this.panel) {
			this.panel.dispose();
			this.panel = null;
		}
	}
}