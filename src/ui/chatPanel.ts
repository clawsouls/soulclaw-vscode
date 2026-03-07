import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { marked } from 'marked';
import type { SoulClawEngine } from '../engine';
import { workspaceTracker } from '../extension';

export class ChatPanel {
	private panel: vscode.WebviewPanel | null = null;
	private messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }> = [];
	private static readonly HISTORY_INDEX_KEY = 'clawsouls.chatHistoryIndex';
	private static readonly MAX_HISTORY = 200;
	private currentWorkspaceKey: string;
	private contextItems: Array<{ label: string; snippet: any }> = [];
	
	constructor(
		private context: vscode.ExtensionContext,
		private engine: SoulClawEngine
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

		// Listen for engine events
		this.engine.on('delta', (text: string) => {
			if (this.panel) {
				this.panel.webview.postMessage({ type: 'streamUpdate', text });
			}
		});

		this.engine.on('final', (message: any) => {
			if (this.panel) {
				this.panel.webview.postMessage({ type: 'clearStream' });
			}
			if (message?.content) {
				this.addMessage('assistant', message.content);
			}
		});

		this.engine.on('error', (err: Error) => {
			this.addMessage('assistant', `Error: ${err.message}`);
		});

		this.engine.on('stateChange', (state: string) => {
			const mappedState = state === 'ready' ? 'connected' : state === 'running' ? 'connected' : state;
			if (this.panel) {
				this.panel.webview.postMessage({ type: 'stateUpdate', state: mappedState });
			}
		});
	}
	
	public show(): void {
		if (this.panel) {
			this.panel.reveal();
			// Re-send current state on reveal
			const state = this.engine.state === 'ready' ? 'connected' : this.engine.state;
			this.panel.webview.postMessage({ type: 'stateUpdate', state });
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

	/** Send a message from external source (e.g. code actions) */
	public sendFromExternal(text: string): void {
		this.sendMessageToAgent(text);
	}

	/** Update context buffer display in chat panel */
	public notifyContextUpdate(items: Array<{ label: string; snippet: any }>): void {
		this.contextItems = items;
		if (this.panel) {
			this.panel.webview.postMessage({
				type: 'contextUpdate',
				items: items.map(i => i.label),
			});
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
			case 'clearChat':
				this.clearChat();
				break;
			case 'switchHistory':
				this.switchHistory();
				break;
			case 'clearContext':
				this.contextItems = [];
				const { clearContextBuffer } = require('../commands/codeActions');
				clearContextBuffer();
				break;
		}
	}
	
	private async sendMessageToAgent(text: string): Promise<void> {
		// Add user message to chat
		this.addMessage('user', text);

		// Send directly to engine — streaming handled via engine events
		try {
			await this.engine.sendMessage(text);
			// final event handler adds the assistant message
		} catch (err: any) {
			// error event handler adds the error message
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
		
		const engineStatus = this.engine.state === 'ready' ? 'connected' : this.engine.state;
		const statusColor = this.getStatusColor(engineStatus);
		
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
				<div class="header" style="display:flex;justify-content:space-between;align-items:center;">
					<div class="status">
						<span class="status-indicator" style="background-color: ${statusColor}"></span>
						Engine: ${engineStatus}
					</div>
					<div style="display:flex;gap:8px;">
						<button id="clearBtn" title="Clear Chat" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--vscode-foreground);opacity:0.7;padding:2px 6px;">🗑️ Clear</button>
						<button id="historyBtn" title="Switch Chat History" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--vscode-foreground);opacity:0.7;padding:2px 6px;">📋 History</button>
					</div>
				</div>
				
				<div class="messages" id="messages">
					${messagesHtml}
				</div>
				
				<div class="input-area">
					<div class="context-bar" id="contextBar" style="display:none;">
						<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-input-border);border-radius:4px 4px 0 0;font-size:12px;">
							<span>📎 Context (<span id="contextCount">0</span> snippets)</span>
							<button id="clearContextBtn" style="background:none;border:none;cursor:pointer;color:var(--vscode-foreground);opacity:0.7;font-size:11px;">Clear</button>
						</div>
						<div id="contextList" style="padding:4px 10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-input-border);border-top:none;border-radius:0 0 4px 4px;font-size:11px;max-height:60px;overflow-y:auto;"></div>
					</div>
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
					
					// Clear & History buttons
					document.getElementById('clearBtn').addEventListener('click', () => {
						vscode.postMessage({ type: 'clearChat' });
					});
					document.getElementById('historyBtn').addEventListener('click', () => {
						vscode.postMessage({ type: 'switchHistory' });
					});
					document.getElementById('clearContextBtn').addEventListener('click', () => {
						vscode.postMessage({ type: 'clearContext' });
						document.getElementById('contextBar').style.display = 'none';
					});
					
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
					
					// Add copy buttons to all code blocks
					function addCopyButtons(container) {
						container.querySelectorAll('pre').forEach(pre => {
							if (pre.querySelector('.copy-btn')) return;
							const btn = document.createElement('button');
							btn.className = 'copy-btn';
							btn.textContent = 'Copy';
							btn.onclick = () => {
								const code = pre.querySelector('code');
								const text = code ? code.textContent : pre.textContent;
								navigator.clipboard.writeText(text).then(() => {
									btn.textContent = '✓';
									setTimeout(() => btn.textContent = 'Copy', 1500);
								});
							};
							pre.appendChild(btn);
						});
					}
					// Initial code blocks
					addCopyButtons(messagesContainer);

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
							addCopyButtons(el);
							messagesContainer.scrollTop = messagesContainer.scrollHeight;
						}
						if (message.type === 'streamUpdate') {
							// Show streaming response with live text
							let streamEl = document.getElementById('streaming');
							if (!streamEl) {
								streamEl = document.createElement('div');
								streamEl.id = 'streaming';
								streamEl.className = 'message assistant-message';
								streamEl.innerHTML = '<div class="message-header"><span class="role-icon">🔮</span><span class="timestamp">typing...</span></div><div class="message-content" id="stream-content"></div>';
								messagesContainer.appendChild(streamEl);
							}
							const contentEl = document.getElementById('stream-content');
							if (contentEl) {
								// Simple markdown: code blocks, bold, inline code
								let html = message.text
									.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
									.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
									.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
									.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
									.replace(/\\n/g, '<br>');
								contentEl.innerHTML = html;
							}
							messagesContainer.scrollTop = messagesContainer.scrollHeight;
						}
						if (message.type === 'clearStream') {
							const streamEl = document.getElementById('streaming');
							if (streamEl) streamEl.remove();
						}
						if (message.type === 'contextUpdate') {
							const bar = document.getElementById('contextBar');
							const list = document.getElementById('contextList');
							const count = document.getElementById('contextCount');
							if (message.items && message.items.length > 0) {
								bar.style.display = 'block';
								count.textContent = message.items.length;
								list.innerHTML = message.items.map(i => '<div style="opacity:0.8;">├ ' + i + '</div>').join('');
							} else {
								bar.style.display = 'none';
							}
						}
						if (message.type === 'stateUpdate') {
							const statusEl = document.querySelector('.status');
							if (statusEl) {
								const colors = { connected: '#00ff00', connecting: '#ffff00', error: '#ff0000', disconnected: '#888888', idle: '#888888' };
								const color = colors[message.state] || '#888888';
								statusEl.innerHTML = '<span class="status-indicator" style="background-color: ' + color + '"></span> Engine: ' + message.state;
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