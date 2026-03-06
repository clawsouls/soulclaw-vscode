import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { marked } from 'marked';
import { GatewayConnection, GatewayMessage } from '../gateway/connection';
import { workspaceTracker } from '../extension';

export class ChatPanel {
	private panel: vscode.WebviewPanel | null = null;
	private messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> = [];
	private static readonly HISTORY_INDEX_KEY = 'clawsouls.chatHistoryIndex';
	private static readonly MAX_HISTORY = 200;
	private currentWorkspaceKey: string;
	
	constructor(
		private context: vscode.ExtensionContext,
		private gateway: GatewayConnection
	) {
		// Workspace-specific history key
		const ws = vscode.workspace.workspaceFolders;
		const wsName = ws && ws.length > 0 ? ws[0].name : '_no_workspace';
		this.currentWorkspaceKey = `clawsouls.chatHistory.${wsName}`;

		// Restore persisted messages for this workspace
		const saved = this.context.globalState.get<typeof this.messages>(this.currentWorkspaceKey);
		if (saved && Array.isArray(saved)) {
			this.messages = saved.slice(-ChatPanel.MAX_HISTORY);
		}

		// Track this workspace in the index
		this.updateHistoryIndex(wsName);

		// Listen for Gateway messages
		this.gateway.onMessage(this.handleGatewayMessage.bind(this));
		
		// Listen for connection state changes
		this.gateway.onStateChanged((state) => {
			if (this.panel) {
				this.panel.webview.postMessage({ type: 'stateUpdate', state });
			}
		});
	}
	
	public show(): void {
		if (this.panel) {
			this.panel.reveal();
			// Re-send current state on reveal
			this.panel.webview.postMessage({ type: 'stateUpdate', state: this.gateway.currentState });
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
		const msg = { role, content, timestamp: Date.now() };
		this.messages.push(msg);
		// Keep bounded and persist
		if (this.messages.length > ChatPanel.MAX_HISTORY) {
			this.messages = this.messages.slice(-ChatPanel.MAX_HISTORY);
		}
		this.context.globalState.update(this.currentWorkspaceKey, this.messages);
		
		if (this.panel) {
			// Clear streaming indicator before updating
			if (role === 'assistant') {
				this.panel.webview.postMessage({ type: 'clearStream' });
			}
			// Append single message instead of full re-render
			const time = new Date(msg.timestamp).toLocaleTimeString();
			const html = marked.parse(msg.content, { async: false }) as string;
			this.panel.webview.postMessage({
				type: 'appendMessage',
				role: msg.role,
				html,
				time
			});
		}
	}
	
	public async clearChat(): Promise<void> {
		this.messages = [];
		this.context.globalState.update(this.currentWorkspaceKey, []);
		if (this.panel) {
			this.updateWebviewContent();
		}
		vscode.window.showInformationMessage('Chat history cleared.');
	}

	public async switchHistory(): Promise<void> {
		const index = this.context.globalState.get<string[]>(ChatPanel.HISTORY_INDEX_KEY) || [];
		if (index.length === 0) {
			vscode.window.showInformationMessage('No chat histories found.');
			return;
		}

		const items = index.map(name => {
			const key = `clawsouls.chatHistory.${name}`;
			const msgs = this.context.globalState.get<any[]>(key) || [];
			const isCurrent = key === this.currentWorkspaceKey;
			return {
				label: `${isCurrent ? '● ' : ''}${name}`,
				description: `${msgs.length} messages${isCurrent ? ' (current)' : ''}`,
				wsName: name,
				key
			};
		});

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select chat history to view'
		});
		if (!picked) return;

		// Load that workspace's history
		const saved = this.context.globalState.get<typeof this.messages>(picked.key) || [];
		this.messages = saved.slice(-ChatPanel.MAX_HISTORY);
		this.currentWorkspaceKey = picked.key;
		if (this.panel) {
			this.updateWebviewContent();
		}
	}

	private updateHistoryIndex(wsName: string): void {
		const index = this.context.globalState.get<string[]>(ChatPanel.HISTORY_INDEX_KEY) || [];
		if (!index.includes(wsName)) {
			index.push(wsName);
			this.context.globalState.update(ChatPanel.HISTORY_INDEX_KEY, index);
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
				// Log ALL messages for debugging
				for (let j = 0; j < messages.length; j++) {
					const m = messages[j];
					outputChannel?.appendLine(`msg[${j}]: role=${m?.role} content=${JSON.stringify(m?.content)?.slice(0, 500)}`);
				}
				const last = messages[messages.length - 1];
				
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
			// Try text blocks first, then any block with text
			const texts = content
				.filter((b: any) => typeof b.text === 'string')
				.map((b: any) => b.text);
			if (texts.length > 0) return texts.join('\n');
			// Fallback: stringify non-empty content
			if (content.length > 0) return JSON.stringify(content);
			return null;
		}
		if (typeof content === 'object' && content !== null) {
			return JSON.stringify(content);
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
		if (!this.panel) return;
		try {
			const fs = require('fs');
			const pathMod = require('path');
			const stat = fs.statSync(filePath);
			if (stat.size > 100 * 1024) {
				vscode.window.showWarningMessage('File too large (>100KB). Skipping.');
				return;
			}
			const content = fs.readFileSync(filePath, 'utf8');
			const filename = pathMod.basename(filePath);
			this.panel.webview.postMessage({
				type: 'insertText',
				text: `📁 ${filename}:\n\`\`\`\n${content}\n\`\`\``
			});
		} catch {
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
						if (message.type === 'appendMessage') {
							const el = document.createElement('div');
							const roleClass = message.role === 'user' ? 'user-message' : 'assistant-message';
							const roleIcon = message.role === 'user' ? '👤' : '🔮';
							el.className = 'message ' + roleClass;
							el.innerHTML = '<div class="message-header"><span class="role-icon">' + roleIcon + '</span><span class="timestamp">' + message.time + '</span></div><div class="message-content">' + message.html + '</div>';
							messagesContainer.appendChild(el);
							messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
						if (message.type === 'stateUpdate') {
							const statusEl = document.querySelector('.status');
							if (statusEl) {
								const colors = { connected: '#00ff00', connecting: '#ffff00', error: '#ff0000', disconnected: '#888888', idle: '#888888' };
								const color = colors[message.state] || '#888888';
								statusEl.innerHTML = '<span class="status-indicator" style="background-color: ' + color + '"></span> Gateway: ' + message.state;
							}
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