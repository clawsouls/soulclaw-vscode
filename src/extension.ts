import * as vscode from 'vscode';
import { SoulBrowserProvider } from './soulBrowser';
import { installSoul, initSoul, exportSoul } from './commands';
import { createDiagnostics } from './validation';
import { createStatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext) {
  // Soul Browser TreeView
  const provider = new SoulBrowserProvider();
  vscode.window.registerTreeDataProvider('soulSpecBrowser', provider);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('soulSpec.install', installSoul),
    vscode.commands.registerCommand('soulSpec.init', initSoul),
    vscode.commands.registerCommand('soulSpec.export', exportSoul),
    vscode.commands.registerCommand('soulSpec.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('soulSpec.search', async () => {
      const query = await vscode.window.showInputBox({ placeHolder: 'Search souls...' });
      provider.setFilter(query || '');
    })
  );

  // Validation
  createDiagnostics(context);

  // Status Bar
  createStatusBar(context);
}

export function deactivate() {}
