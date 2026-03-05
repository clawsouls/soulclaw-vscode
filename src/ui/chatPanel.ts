import * as vscode from 'vscode';
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
	
	private handleGatewayMessage(message: GatewayMessage): void {
		// Handle responses from the agent
		if (message.type === 'agent_response') {
			this.addMessage('assistant', message.data?.content || 'No response');
		}
	}
	
	private sendMessageToAgent(text: string): void {
		// Add user message to chat
		this.addMessage('user', text);
		
		// Add workspace context
		const context = workspaceTracker?.getContext() || {};
		
		// Send to Gateway
		this.gateway.sendMessage({
			type: 'chat_message',
			data: {
				message: text,
				context: context
			}
		});
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