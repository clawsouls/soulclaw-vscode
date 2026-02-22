import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function createStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'soulSpec.openScanDetails';
  context.subscriptions.push(item);

  context.subscriptions.push(
    vscode.commands.registerCommand('soulSpec.openScanDetails', () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) { return; }
      try {
        const soul = JSON.parse(fs.readFileSync(path.join(root, 'soul.json'), 'utf-8'));
        const owner = soul.author?.github || soul.author?.name || '_';
        vscode.env.openExternal(vscode.Uri.parse(`https://clawsouls.ai/souls/${owner}/${soul.name}`));
      } catch {
        vscode.env.openExternal(vscode.Uri.parse('https://clawsouls.ai'));
      }
    })
  );

  const update = () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !fs.existsSync(path.join(root, 'soul.json'))) {
      item.hide();
      return;
    }
    try {
      const soul = JSON.parse(fs.readFileSync(path.join(root, 'soul.json'), 'utf-8'));
      item.text = `$(shield) Soul Spec`;
      item.tooltip = `${soul.name} v${soul.version}`;
      item.show();
    } catch {
      item.hide();
    }
  };

  update();
  vscode.workspace.onDidChangeWorkspaceFolders(update, null, context.subscriptions);

  const watcher = vscode.workspace.createFileSystemWatcher('**/soul.json');
  watcher.onDidChange(update);
  watcher.onDidCreate(update);
  watcher.onDidDelete(update);
  context.subscriptions.push(watcher);

  return item;
}
