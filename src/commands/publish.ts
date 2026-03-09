import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Publish the current workspace's soul.json to clawsouls.ai
 */
export async function publishSoul(context: vscode.ExtensionContext): Promise<void> {
	const ws = vscode.workspace.workspaceFolders;
	if (!ws) {
		vscode.window.showErrorMessage('No workspace open.');
		return;
	}

	const soulPath = path.join(ws[0].uri.fsPath, 'soul.json');
	if (!fs.existsSync(soulPath)) {
		vscode.window.showErrorMessage('No soul.json found in workspace root.');
		return;
	}

	// Read soul.json
	let soulData: any;
	try {
		soulData = JSON.parse(fs.readFileSync(soulPath, 'utf8'));
	} catch (err: any) {
		vscode.window.showErrorMessage(`Invalid soul.json: ${err.message}`);
		return;
	}

	// Get API token from SecretStorage
	const token = await context.secrets.get('clawsouls.apiToken');
	if (!token) {
		const setToken = await vscode.window.showErrorMessage(
			'No API token configured. Set your ClawSouls API token first.',
			'Set Token'
		);
		if (setToken === 'Set Token') {
			const input = await vscode.window.showInputBox({
				prompt: 'Enter your ClawSouls API token (cs_...)',
				password: true,
				placeHolder: 'cs_...',
			});
			if (input) {
				await context.secrets.store('clawsouls.apiToken', input);
				// Retry
				return publishSoul(context);
			}
		}
		return;
	}

	// Confirm
	const confirm = await vscode.window.showInformationMessage(
		`Publish "${soulData.displayName || soulData.name}" to clawsouls.ai?`,
		'Publish', 'Cancel'
	);
	if (confirm !== 'Publish') return;

	// Publish
	try {
		const response = await fetch('https://clawsouls.ai/api/v1/souls', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`,
			},
			body: JSON.stringify(soulData),
		});

		if (response.ok) {
			const result = await response.json() as any;
			vscode.window.showInformationMessage(
				`✅ Soul published successfully! ${result.url || ''}`
			);
		} else {
			const errorText = await response.text();
			vscode.window.showErrorMessage(
				`Publish failed (${response.status}): ${errorText.slice(0, 200)}`
			);
		}
	} catch (err: any) {
		vscode.window.showErrorMessage(`Publish failed: ${err.message}`);
	}
}
