import * as vscode from 'vscode';
import { Soul, getSouls } from './api';

export class SoulBrowserProvider implements vscode.TreeDataProvider<SoulItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SoulItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private souls: Soul[] = [];
  private filter: string = '';

  refresh(): void {
    this.souls = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  setFilter(filter: string): void {
    this.filter = filter.toLowerCase();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SoulItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SoulItem[]> {
    if (this.souls.length === 0) {
      try {
        this.souls = await getSouls();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to fetch souls: ${e}`);
        return [];
      }
    }

    let filtered = this.souls;
    if (this.filter) {
      filtered = this.souls.filter(s =>
        s.name.toLowerCase().includes(this.filter) ||
        s.description.toLowerCase().includes(this.filter) ||
        s.category.toLowerCase().includes(this.filter) ||
        s.tags.some(t => t.toLowerCase().includes(this.filter))
      );
    }

    return filtered.map(s => new SoulItem(s));
  }
}

class SoulItem extends vscode.TreeItem {
  constructor(public readonly soul: Soul) {
    super(soul.displayName || soul.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${soul.owner} · ${soul.category || 'uncategorized'}`;
    this.tooltip = new vscode.MarkdownString(
      `**${soul.displayName || soul.name}** v${soul.version}\n\n` +
      `${soul.description}\n\n` +
      `📥 ${soul.downloads} downloads` +
      (soul.scanScore !== null ? ` · 🛡️ Score: ${soul.scanScore}` : '') +
      (soul.avgRating !== null ? ` · ⭐ ${soul.avgRating}` : '')
    );
    this.iconPath = new vscode.ThemeIcon('person');
    this.command = {
      command: 'soulSpec.install',
      title: 'Install Soul',
      arguments: [soul]
    };
  }
}
