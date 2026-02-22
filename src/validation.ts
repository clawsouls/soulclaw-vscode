import * as vscode from 'vscode';

const REQUIRED_FIELDS = ['name', 'version', 'specVersion', 'description'];

export function createDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  const diagnostics = vscode.languages.createDiagnosticCollection('soul-spec');
  context.subscriptions.push(diagnostics);

  const validate = (doc: vscode.TextDocument) => {
    if (!doc.fileName.endsWith('soul.json')) {
      return;
    }

    const diags: vscode.Diagnostic[] = [];
    const text = doc.getText();

    try {
      const json = JSON.parse(text);

      for (const field of REQUIRED_FIELDS) {
        if (!json[field]) {
          const pos = new vscode.Position(0, 0);
          diags.push(new vscode.Diagnostic(
            new vscode.Range(pos, pos),
            `Missing required field: "${field}"`,
            vscode.DiagnosticSeverity.Error
          ));
        }
      }

      if (json.specVersion && !['0.3', '0.4'].includes(json.specVersion)) {
        diags.push(new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          `Unsupported specVersion "${json.specVersion}". Use "0.4".`,
          vscode.DiagnosticSeverity.Warning
        ));
      }

      if (json.name && !/^[a-z0-9-]+$/.test(json.name)) {
        diags.push(new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          'Soul name must be lowercase alphanumeric with hyphens only.',
          vscode.DiagnosticSeverity.Error
        ));
      }

      if (!json.files || !json.files.soul) {
        diags.push(new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          'Missing "files.soul" — should point to SOUL.md.',
          vscode.DiagnosticSeverity.Warning
        ));
      }
    } catch {
      diags.push(new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 0),
        'Invalid JSON in soul.json',
        vscode.DiagnosticSeverity.Error
      ));
    }

    diagnostics.set(doc.uri, diags);
  };

  vscode.workspace.onDidOpenTextDocument(validate, null, context.subscriptions);
  vscode.workspace.onDidChangeTextDocument(e => validate(e.document), null, context.subscriptions);
  vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri), null, context.subscriptions);

  // Validate already open docs
  vscode.workspace.textDocuments.forEach(validate);

  return diagnostics;
}
