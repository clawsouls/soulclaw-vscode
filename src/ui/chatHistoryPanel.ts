import * as vscode from 'vscode';

interface ChatHistoryItem {
	wsName: string;
	key: string;
	messageCount: number;
	isCurrent: boolean;
}

class ChatHistoryNode extends vscode.TreeItem {
	constructor(public readonly item: ChatHistoryItem) {
		super(item.wsName, vscode.TreeItemCollapsibleState.None);
		this.description = `${item.messageCount} messages`;
		this.iconPath = new vscode.ThemeIcon(item.isCurrent ? 'comment-discussion' : 'comment');
		this.contextValue = 'chatHistory';
		this.command = {
			command: 'clawsouls.openChatHistory',
			title: 'Open Chat History',
			arguments: [item]
		};
		if (item.isCurrent) {
			this.description += ' (current)';
		}
	}
}

class ChatHistoryActionNode extends vscode.TreeItem {
	constructor(label: string, command: string, icon: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(icon);
		this.command = { command, title: label };
	}
}

type HistoryNode = ChatHistoryNode | ChatHistoryActionNode;

export class ChatHistoryProvider implements vscode.TreeDataProvider<HistoryNode> {
	private _onDidChangeTreeData = new vscode.EventEmitter<HistoryNode | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private context: vscode.ExtensionContext) {
		context.subscriptions.push(
			vscode.commands.registerCommand('clawsouls.openChatHistory', (item: ChatHistoryItem) => {
				vscode.commands.executeCommand('clawsouls.openChat');
				vscode.commands.executeCommand('clawsouls.loadHistory', item.key, item.wsName);
			}),
			vscode.commands.registerCommand('clawsouls.deleteChatHistory', (node: ChatHistoryNode) => {
				this.deleteHistory(node.item);
			}),
			vscode.commands.registerCommand('clawsouls.newChat', async () => {
				const name = await vscode.window.showInputBox({
					prompt: 'Chat session name',
					placeHolder: 'e.g. debug-session, feature-planning',
				});
				if (!name) return;
				const indexKey = 'clawsouls.chatHistoryIndex';
				const index = this.context.globalState.get<string[]>(indexKey) || [];
				if (!index.includes(name)) {
					index.push(name);
					await this.context.globalState.update(indexKey, index);
				}
				const key = `clawsouls.chatHistory.${name}`;
				await this.context.globalState.update(key, []);
				this.refresh();
				vscode.commands.executeCommand('clawsouls.openChat');
				vscode.commands.executeCommand('clawsouls.loadHistory', key, name);
			})
		);
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: HistoryNode): vscode.TreeItem {
		return element;
	}

	getChildren(): HistoryNode[] {
		const indexKey = 'clawsouls.chatHistoryIndex';
		const index = this.context.globalState.get<string[]>(indexKey) || [];

		if (index.length === 0) {
			return [new ChatHistoryActionNode('Start chatting to create history', 'clawsouls.openChat', 'comment')];
		}

		const ws = vscode.workspace.workspaceFolders;
		const currentWs = ws && ws.length > 0 ? ws[0].name : '_no_workspace';

		const items: HistoryNode[] = index.map(wsName => {
			const key = `clawsouls.chatHistory.${wsName}`;
			const msgs = this.context.globalState.get<any[]>(key) || [];
			return new ChatHistoryNode({
				wsName,
				key,
				messageCount: msgs.length,
				isCurrent: wsName === currentWs
			});
		});
		items.push(new ChatHistoryActionNode('➕ New Chat', 'clawsouls.newChat', 'add'));
		return items;
	}

	private async deleteHistory(item: ChatHistoryItem): Promise<void> {
		const confirm = await vscode.window.showWarningMessage(
			`Delete chat history for "${item.wsName}"?`,
			{ modal: true },
			'Delete'
		);
		if (confirm !== 'Delete') return;

		await this.context.globalState.update(item.key, undefined);
		const indexKey = 'clawsouls.chatHistoryIndex';
		const index = this.context.globalState.get<string[]>(indexKey) || [];
		const newIndex = index.filter(n => n !== item.wsName);
		await this.context.globalState.update(indexKey, newIndex);
		this.refresh();
	}
}
