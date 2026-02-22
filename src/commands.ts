import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Soul, getSouls, getBundle } from './api';

export async function installSoul(soul?: Soul): Promise<void> {
  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage('Open a workspace folder first.');
    return;
  }

  if (!soul) {
    const souls = await getSouls();
    const pick = await vscode.window.showQuickPick(
      souls.map(s => ({
        label: s.displayName || s.name,
        description: `${s.owner}/${s.name}`,
        detail: s.description,
        soul: s
      })),
      { placeHolder: 'Search and select a soul to install', matchOnDescription: true, matchOnDetail: true }
    );
    if (!pick) { return; }
    soul = pick.soul;
  }

  try {
    const bundle = await getBundle(soul.owner, soul.name);
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

    if (bundle.files) {
      for (const [filename, content] of Object.entries(bundle.files)) {
        const filePath = path.join(root, filename);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.writeFileSync(filePath, content as string, 'utf-8');
      }
    }

    if (bundle.soul) {
      fs.writeFileSync(path.join(root, 'soul.json'), JSON.stringify(bundle.soul, null, 2), 'utf-8');
    }

    vscode.window.showInformationMessage(`Installed soul: ${soul.displayName || soul.name}`);
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to install soul: ${e}`);
  }
}

export async function initSoul(): Promise<void> {
  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage('Open a workspace folder first.');
    return;
  }

  const name = await vscode.window.showInputBox({ prompt: 'Soul name (lowercase, hyphens)', placeHolder: 'my-soul' });
  if (!name) { return; }

  const description = await vscode.window.showInputBox({ prompt: 'Description', placeHolder: 'A helpful AI assistant' });
  if (!description) { return; }

  const personality = await vscode.window.showInputBox({ prompt: 'Personality traits (comma-separated)', placeHolder: 'friendly, concise, professional' });

  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;

  const soulJson = {
    name,
    version: '0.1.0',
    specVersion: '0.4',
    description,
    author: { name: '' },
    license: 'Apache-2.0',
    tags: [],
    category: 'general',
    files: {
      soul: 'SOUL.md'
    }
  };

  const traits = personality ? personality.split(',').map(t => t.trim()) : ['helpful'];
  const soulMd = `# ${name}\n\n${description}\n\n## Personality\n\n${traits.map(t => `- ${t}`).join('\n')}\n\n## Instructions\n\nAdd your instructions here.\n`;

  fs.writeFileSync(path.join(root, 'soul.json'), JSON.stringify(soulJson, null, 2), 'utf-8');
  fs.writeFileSync(path.join(root, 'SOUL.md'), soulMd, 'utf-8');

  vscode.window.showInformationMessage(`Soul "${name}" initialized!`);
  const doc = await vscode.workspace.openTextDocument(path.join(root, 'SOUL.md'));
  vscode.window.showTextDocument(doc);
}

export async function exportSoul(): Promise<void> {
  if (!vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage('Open a workspace folder first.');
    return;
  }

  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const soulMdPath = path.join(root, 'SOUL.md');

  if (!fs.existsSync(soulMdPath)) {
    vscode.window.showErrorMessage('No SOUL.md found. Run "Soul Spec: Init" first.');
    return;
  }

  const content = fs.readFileSync(soulMdPath, 'utf-8');

  const platform = await vscode.window.showQuickPick([
    { label: 'Claude Code', description: 'Export as CLAUDE.md', target: 'claude' },
    { label: 'Cursor', description: 'Export to .cursor/rules/', target: 'cursor' },
    { label: 'Windsurf', description: 'Export as .windsurfrules', target: 'windsurf' },
    { label: 'OpenClaw', description: 'Keep as-is (soul.json + SOUL.md)', target: 'openclaw' }
  ], { placeHolder: 'Export soul for which platform?' });

  if (!platform) { return; }

  switch (platform.target) {
    case 'claude':
      fs.writeFileSync(path.join(root, 'CLAUDE.md'), content, 'utf-8');
      vscode.window.showInformationMessage('Exported to CLAUDE.md');
      break;
    case 'cursor': {
      const dir = path.join(root, '.cursor', 'rules');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'soul.md'), content, 'utf-8');
      vscode.window.showInformationMessage('Exported to .cursor/rules/soul.md');
      break;
    }
    case 'windsurf':
      fs.writeFileSync(path.join(root, '.windsurfrules'), content, 'utf-8');
      vscode.window.showInformationMessage('Exported to .windsurfrules');
      break;
    case 'openclaw':
      vscode.window.showInformationMessage('OpenClaw uses soul.json + SOUL.md as-is. No export needed.');
      break;
  }
}
