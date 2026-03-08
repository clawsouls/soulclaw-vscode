import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';

const API_BASE = 'https://clawsouls.ai/api/v1';

function apiGet(urlPath: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const url = `${API_BASE}${urlPath}`;
		https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
			let data = '';
			res.on('data', (chunk: string) => data += chunk);
			res.on('end', () => {
				try { resolve(JSON.parse(data)); }
				catch { reject(new Error(`Invalid JSON from ${url}`)); }
			});
		}).on('error', reject);
	});
}

export function setupWizard(): Promise<{ completed: boolean }> {
	return new Promise((resolve) => {
		const panel = vscode.window.createWebviewPanel(
			'clawsoulsSetup',
			'ClawSouls Setup',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true
			}
		);

		let currentStep = 1;
		const maxSteps = 6;
		let selectedProvider = '';
		let finished = false;

		panel.onDidDispose(() => {
			if (!finished) {
				resolve({ completed: false });
			}
		});

		panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'next':
					if (currentStep === 1 && message.data?.provider) {
						selectedProvider = message.data.provider;
					}
					await handleNextStep(panel, message.data, currentStep);
					currentStep++;
					updateWebviewContent(panel, currentStep, selectedProvider);
					break;
				case 'back':
					currentStep--;
					updateWebviewContent(panel, currentStep, selectedProvider);
					break;
				case 'finish':
					finished = true;
					await finishSetup(panel, message.data);
					panel.dispose();
					resolve({ completed: true });
					break;
				case 'skip':
					finished = true;
					panel.dispose();
					resolve({ completed: true });
					break;
				case 'testTelegram':
					try {
						const result = await testTelegramConnection(message.data.botToken, message.data.chatId);
						panel.webview.postMessage({ type: 'telegramTestResult', success: true, botName: result });
					} catch (err: any) {
						panel.webview.postMessage({ type: 'telegramTestResult', success: false, error: err.message });
					}
					break;
				case 'saveTelegram':
					await saveTelegramConfig(message.data.botToken, message.data.chatId);
					// Restart relay so it picks up new config without requiring Reload Window
					try { await vscode.commands.executeCommand('clawsouls.restartTelegram'); } catch {}
					// Advance to next step in wizard
					currentStep++;
					updateWebviewContent(panel, currentStep, selectedProvider);
					break;
				case 'fetchSouls':
					try {
						const resp = await apiGet('/souls?limit=200');
						panel.webview.postMessage({ type: 'soulsLoaded', souls: resp.souls || [] });
					} catch {
						panel.webview.postMessage({ type: 'soulsLoaded', souls: [] });
					}
					break;
				case 'validateApiKey':
					try {
						const valid = await validateApiKey(message.data.provider, message.data.apiKey);
						panel.webview.postMessage({ type: 'apiKeyValidated', valid, error: valid ? null : 'Invalid API key' });
					} catch (err: any) {
						panel.webview.postMessage({ type: 'apiKeyValidated', valid: false, error: err.message });
					}
					break;
				case 'applySoul':
					try {
						await applySoulFromOnboarding(message.data.owner, message.data.name);
						panel.webview.postMessage({ type: 'soulApplied', success: true });
					} catch (err: any) {
						panel.webview.postMessage({ type: 'soulApplied', success: false, error: err.message });
					}
					break;
				case 'checkOllama':
					checkOllamaSetup(panel);
					break;
			}
		});

		updateWebviewContent(panel, currentStep);
	});
}

async function handleNextStep(panel: vscode.WebviewPanel, data: any, step: number): Promise<void> {
	try {
		const config = vscode.workspace.getConfiguration('clawsouls');

		switch (step) {
			case 1:
				await config.update('llmProvider', data.provider, vscode.ConfigurationTarget.Global);
				// Reset model when switching providers to avoid cross-contamination
				await config.update('llmModel', '', vscode.ConfigurationTarget.Global);
				break;
			case 2:
				if (data.apiKey) {
					await config.update('llmApiKey', data.apiKey, vscode.ConfigurationTarget.Global);
					// Will be migrated to SecretStorage on next engine restart
				}
				if (data.model) {
					await config.update('llmModel', data.model, vscode.ConfigurationTarget.Global);
				}
				if (data.ollamaUrl) {
					await config.update('ollamaUrl', data.ollamaUrl, vscode.ConfigurationTarget.Global);
				}
				if (data.ollamaModel) {
					await config.update('ollamaModel', data.ollamaModel, vscode.ConfigurationTarget.Global);
				}
				break;
			case 3:
				if (data.soulChoice === 'custom') {
					await createCustomSoul(data.soulName);
				}
				break;
			case 4:
				// Telegram handled by 'saveTelegram' message type
				break;
		}
	} catch (err) {
		console.error(`Setup step ${step} error:`, err);
	}

}

async function finishSetup(panel: vscode.WebviewPanel, data: any): Promise<void> {
	// Show completion message
	vscode.window.showInformationMessage('SoulClaw setup completed! 🎉');

	// Auto-open chat if requested
	if (data.openChat) {
		vscode.commands.executeCommand('clawsouls.openChat');
	}
}

function getWorkspaceDirectory(): string {
	const { getWorkspaceDir } = require('../paths');
	return getWorkspaceDir();
}

async function applySoulFromOnboarding(owner: string, name: string): Promise<void> {
	const bundle = await apiGet(`/bundle/${owner}/${name}`);
	const bundleFiles: Record<string, string> = bundle.files || {};
	const manifest = bundle.manifest || {};
	const targetDir = getWorkspaceDirectory();
	fs.mkdirSync(targetDir, { recursive: true });

	const knownFiles: Record<string, string> = {
		'SOUL.md': 'soul', 'IDENTITY.md': 'identity', 'STYLE.md': 'style',
		'AGENTS.md': 'agents', 'README.md': 'readme', 'HEARTBEAT.md': 'heartbeat',
		'USER.md': 'user', 'MEMORY.md': 'memory', 'TOOLS.md': 'tools', 'BOOTSTRAP.md': 'bootstrap',
	};

	const filesMap: Record<string, string> = {};
	for (const filename of Object.keys(bundleFiles)) {
		if (filename === 'soul.json' || filename === 'LICENSE') continue;
		const key = knownFiles[filename] || filename;
		filesMap[key] = filename;
	}

	const soulJson = {
		name: manifest.name || name,
		displayName: manifest.displayName || name,
		description: manifest.description || '',
		version: manifest.version || '1.0.0',
		specVersion: '0.5',
		license: manifest.license || 'Apache-2.0',
		tags: manifest.tags || [],
		category: manifest.category || 'general',
		files: filesMap
	};

	fs.writeFileSync(path.join(targetDir, 'soul.json'), JSON.stringify(soulJson, null, 2));
	for (const [filename, content] of Object.entries(bundleFiles)) {
		if (filename === 'soul.json') continue;
		if (typeof content !== 'string') continue;
		fs.writeFileSync(path.join(targetDir, filename), content);
	}
}

async function validateApiKey(provider: string, apiKey: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		if (provider === 'anthropic') {
			const body = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
			const req = https.request({
				hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
			}, (res) => {
				let data = '';
				res.on('data', (c: string) => data += c);
				res.on('end', () => resolve(res.statusCode === 200));
			});
			req.on('error', reject);
			req.write(body);
			req.end();
		} else if (provider === 'openai') {
			const req = https.request({
				hostname: 'api.openai.com', path: '/v1/models', method: 'GET',
				headers: { 'Authorization': `Bearer ${apiKey}` },
			}, (res) => {
				let data = '';
				res.on('data', (c: string) => data += c);
				res.on('end', () => resolve(res.statusCode === 200));
			});
			req.on('error', reject);
			req.end();
		} else {
			resolve(true);
		}
	});
}

async function testTelegramConnection(botToken: string, chatId: string): Promise<string> {
	return new Promise((resolve, reject) => {
		// Test getMe
		const url = `https://api.telegram.org/bot${botToken}/getMe`;
		https.get(url, (res) => {
			let data = '';
			res.on('data', (chunk: string) => data += chunk);
			res.on('end', () => {
				try {
					const parsed = JSON.parse(data);
					if (!parsed.ok) {
						reject(new Error(parsed.description || 'Invalid bot token'));
						return;
					}
					const botName = parsed.result.first_name || parsed.result.username;
					// Send test message if chatId provided
					if (chatId) {
						const msgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
						const payload = JSON.stringify({ chat_id: chatId, text: '🔮 SoulClaw connected!' });
						const req = https.request(msgUrl, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
						}, (res2) => {
							let d2 = '';
							res2.on('data', (c: string) => d2 += c);
							res2.on('end', () => {
								try {
									const r = JSON.parse(d2);
									if (r.ok) resolve(botName);
									else reject(new Error(r.description || 'Failed to send test message'));
								} catch { reject(new Error('Invalid response')); }
							});
						});
						req.on('error', reject);
						req.write(payload);
						req.end();
					} else {
						resolve(botName);
					}
				} catch { reject(new Error('Invalid response from Telegram API')); }
			});
		}).on('error', reject);
	});
}

async function saveTelegramConfig(botToken: string, chatId: string): Promise<void> {
	const { getStateDir } = require('../paths');
	const stateDir = getStateDir();
	const configPath = path.join(stateDir, 'config.yaml');
	
	fs.mkdirSync(stateDir, { recursive: true });

	// Read existing or create new
	let content = '';
	try { content = fs.readFileSync(configPath, 'utf8'); } catch {}

	// Simple YAML append/replace for telegram channel
	const telegramBlock = `\nchannels:\n  telegram:\n    adapter: telegram\n    token: "${botToken}"\n    allowedChatIds:\n      - "${chatId}"\n`;

	if (content.includes('channels:')) {
		// Replace existing channels block (simple approach)
		content = content.replace(/\nchannels:[\s\S]*?(?=\n\w|\n$|$)/, telegramBlock);
	} else {
		content += telegramBlock;
	}

	fs.writeFileSync(configPath, content);
}

async function createCustomSoul(name: string): Promise<void> {
	const workspaces = vscode.workspace.workspaceFolders;
	if (!workspaces || workspaces.length === 0) {
		vscode.window.showErrorMessage('Please open a workspace first.');
		return;
	}

	const workspaceUri = workspaces[0].uri;
	
	// Create soul.json
	const soulConfig = {
		name: name || 'Custom Soul',
		version: '1.0.0',
		description: 'A custom soul created with SoulClaw',
		created: new Date().toISOString()
	};

	const soulJsonUri = vscode.Uri.joinPath(workspaceUri, 'soul.json');
	await vscode.workspace.fs.writeFile(soulJsonUri, Buffer.from(JSON.stringify(soulConfig, null, 2)));

	// Create SOUL.md
	const soulMarkdown = `# ${name || 'Custom Soul'}

## Persona

You are a helpful AI assistant.

## Communication Style

- Be concise and clear
- Ask clarifying questions when needed
- Provide actionable advice

## Capabilities

- General assistance
- Code help
- Research and analysis
- Creative tasks

## Limitations

- I don't have access to real-time information
- I cannot browse the internet
- I cannot execute code directly
`;

	const soulMdUri = vscode.Uri.joinPath(workspaceUri, 'SOUL.md');
	await vscode.workspace.fs.writeFile(soulMdUri, Buffer.from(soulMarkdown));
}

function updateWebviewContent(panel: vscode.WebviewPanel, step: number, provider?: string): void {
	panel.webview.html = getWebviewContent(step, provider);
}

function getWebviewContent(step: number, provider?: string): string {
	switch (step) {
		case 1:
			return getStep1Html();
		case 2:
			return getStep2Html(provider);
		case 3:
			return getStep3Html();
		case 4:
			return getStep4TelegramHtml();
		case 5:
			return getStep5OllamaMemoryHtml();
		case 6:
			return getStep6CompleteHtml();
		default:
			return getStep1Html();
	}
}

function getStep1Html(): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>ClawSouls Setup - Step 1</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 30px; }
				.provider-card { 
					border: 1px solid var(--vscode-input-border); 
					border-radius: 8px; 
					padding: 20px; 
					margin: 10px 0; 
					cursor: pointer; 
					transition: all 0.2s; 
				}
				.provider-card:hover { 
					border-color: var(--vscode-button-background); 
					background: var(--vscode-button-hoverBackground); 
				}
				.provider-card.selected { 
					border-color: var(--vscode-button-background); 
					background: var(--vscode-button-background); 
					color: var(--vscode-button-foreground); 
				}
				.buttons { text-align: center; margin-top: 30px; }
				button { 
					margin: 0 10px; 
					padding: 10px 20px; 
					border: none; 
					background: var(--vscode-button-background); 
					color: var(--vscode-button-foreground); 
					border-radius: 4px; 
					cursor: pointer; 
				}
				button:disabled { opacity: 0.5; cursor: not-allowed; }
				.recommended { color: var(--vscode-charts-green); font-weight: bold; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="step-header">
					<h1>🔮 Welcome to SoulClaw</h1>
					<p>Step 1 of 6: Choose your LLM provider</p>
				</div>
				
				<div class="provider-card" data-provider="anthropic">
					<h3>🧠 Anthropic Claude <span class="recommended">(Recommended)</span></h3>
					<p>Best overall experience with excellent reasoning and coding capabilities.</p>
				</div>
				
				<div class="provider-card" data-provider="openai">
					<h3>🤖 OpenAI GPT</h3>
					<p>Popular choice with good general performance and wide compatibility.</p>
				</div>
				
				<div class="provider-card" data-provider="ollama">
					<h3>🏠 Local Ollama</h3>
					<p>Privacy-focused local models. Requires Ollama installed on your system.</p>
				</div>
				
				<div class="buttons">
					<button onclick="skip()">Skip Setup</button>
					<button id="nextBtn" onclick="next()" disabled>Next →</button>
				</div>
			</div>
			
			<script>
				const vscode = acquireVsCodeApi();
				let selectedProvider = null;
				
				document.querySelectorAll('.provider-card').forEach(card => {
					card.addEventListener('click', () => {
						document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
						card.classList.add('selected');
						selectedProvider = card.dataset.provider;
						document.getElementById('nextBtn').disabled = false;
					});
				});
				
				function next() {
					if (selectedProvider) {
						vscode.postMessage({
							type: 'next',
							data: { provider: selectedProvider }
						});
					}
				}
				
				function skip() {
					vscode.postMessage({ type: 'skip' });
				}
			</script>
		</body>
		</html>
	`;
}

function getStep2Html(provider?: string): string {
	// Read provider from VSCode config
	const isOllama = provider === 'ollama';

	if (isOllama) {
		return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>ClawSouls Setup - Step 2</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 30px; }
				.config-section {
					border: 1px solid var(--vscode-input-border);
					border-radius: 8px;
					padding: 20px;
					margin: 15px 0;
				}
				input[type="text"] {
					width: 100%;
					padding: 8px;
					border: 1px solid var(--vscode-input-border);
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					border-radius: 4px;
					margin-top: 8px;
				}
				.hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 6px; }
				.buttons { text-align: center; margin-top: 30px; }
				button {
					margin: 0 10px;
					padding: 10px 20px;
					border: none;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border-radius: 4px;
					cursor: pointer;
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="step-header">
					<h1>🏠 Ollama Configuration</h1>
					<p>Step 2 of 6: Configure your local Ollama instance</p>
				</div>

				<div class="config-section">
					<h3>Ollama URL</h3>
					<input type="text" id="ollamaUrl" value="http://127.0.0.1:11434" />
					<div class="hint">Default: http://127.0.0.1:11434</div>
				</div>

				<div class="config-section">
					<h3>Model</h3>
					<input type="text" id="ollamaModel" placeholder="llama3, codellama, mistral..." value="llama3" />
					<div class="hint">Enter the model name you have pulled in Ollama.</div>
				</div>

				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button onclick="next()">Next →</button>
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function next() {
					vscode.postMessage({
						type: 'next',
						data: {
							ollamaUrl: document.getElementById('ollamaUrl').value,
							ollamaModel: document.getElementById('ollamaModel').value
						}
					});
				}

				function back() {
					vscode.postMessage({ type: 'back' });
				}
			</script>
		</body>
		</html>
		`;
	}

	// Anthropic / OpenAI — API key
	const placeholder = provider === 'openai' ? 'sk-...' : 'sk-ant-...';
	const providerName = provider === 'openai' ? 'OpenAI' : 'Anthropic';

	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>ClawSouls Setup - Step 2</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 30px; }
				.auth-option {
					border: 1px solid var(--vscode-input-border);
					border-radius: 8px;
					padding: 20px;
					margin: 15px 0;
				}
				input[type="password"] {
					width: 100%;
					padding: 8px;
					border: 1px solid var(--vscode-input-border);
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					border-radius: 4px;
				}
				.buttons { text-align: center; margin-top: 30px; }
				button {
					margin: 0 10px;
					padding: 10px 20px;
					border: none;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border-radius: 4px;
					cursor: pointer;
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="step-header">
					<h1>🔑 Authentication</h1>
					<p>Step 2 of 6: Set up your ${providerName} API access</p>
				</div>

				<div class="auth-option">
					<h3>🔐 ${providerName} API Key</h3>
					<p>Enter your API key to get started:</p>
					<input type="password" id="apiKey" placeholder="${placeholder}" />
					<small>Your API key is stored securely in VSCode SecretStorage.</small>
					<div style="margin-top:8px;">
						<button onclick="validateKey()" style="padding:6px 16px;border:none;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-radius:4px;cursor:pointer;">🔑 Validate Key</button>
						<span id="validateResult" style="margin-left:8px;font-size:12px;"></span>
					</div>
				</div>

				<div class="auth-option">
					<h3>🤖 Model</h3>
					<select id="modelSelect" style="width:100%;padding:8px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px;">
						${provider === 'openai' ? `
							<option value="">Default (gpt-4o)</option>
							<option value="gpt-4o">GPT-4o</option>
							<option value="gpt-4o-mini">GPT-4o Mini</option>
							<option value="gpt-4-turbo">GPT-4 Turbo</option>
							<option value="o1">o1</option>
							<option value="o1-mini">o1-mini</option>
						` : `
							<option value="">Default (claude-sonnet-4-20250514)</option>
							<option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
							<option value="claude-opus-4-20250514">Claude Opus 4</option>
							<option value="claude-haiku-35-20241022">Claude 3.5 Haiku</option>
						`}
					</select>
					<small>Leave as default unless you have a preference.</small>
				</div>

				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button onclick="next()">Next →</button>
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function validateKey() {
					const apiKey = document.getElementById('apiKey').value;
					if (!apiKey) { document.getElementById('validateResult').textContent = '❌ Enter a key first'; return; }
					document.getElementById('validateResult').textContent = '⏳ Validating...';
					vscode.postMessage({ type: 'validateApiKey', data: { provider: '${provider}', apiKey } });
				}

				window.addEventListener('message', event => {
					if (event.data.type === 'apiKeyValidated') {
						document.getElementById('validateResult').textContent = event.data.valid ? '✅ Valid!' : '❌ ' + (event.data.error || 'Invalid');
					}
				});

				function next() {
					const apiKey = document.getElementById('apiKey').value;
					const model = document.getElementById('modelSelect').value;
					vscode.postMessage({
						type: 'next',
						data: { apiKey, model }
					});
				}

				function back() {
					vscode.postMessage({ type: 'back' });
				}
			</script>
		</body>
		</html>
	`;
}

function getStep3Html(): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>ClawSouls Setup - Step 4</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; margin: 0; }
				.container { max-width: 700px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 20px; }
				.search-bar {
					width: 100%; padding: 10px 14px; border: 1px solid var(--vscode-input-border);
					background: var(--vscode-input-background); color: var(--vscode-input-foreground);
					border-radius: 6px; font-size: 14px; box-sizing: border-box; margin-bottom: 12px;
				}
				.filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
				.filter-btn {
					padding: 4px 12px; border: 1px solid var(--vscode-input-border); border-radius: 14px;
					background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 12px;
				}
				.filter-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
				.soul-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-height: 420px; overflow-y: auto; padding-right: 4px; }
				.soul-card {
					border: 1px solid var(--vscode-input-border); border-radius: 8px; padding: 14px;
					cursor: pointer; transition: all 0.15s; position: relative;
				}
				.soul-card:hover { border-color: var(--vscode-button-background); }
				.soul-card.selected { border-color: var(--vscode-button-background); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
				.soul-card .name { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
				.soul-card .owner { font-size: 11px; opacity: 0.7; margin-bottom: 6px; }
				.soul-card .desc { font-size: 12px; opacity: 0.85; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
				.soul-card .meta { font-size: 11px; opacity: 0.6; margin-top: 6px; }
				.soul-card .badge { position: absolute; top: 8px; right: 8px; font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
				.loading { text-align: center; padding: 40px; opacity: 0.7; }
				.bottom-options { margin-top: 16px; display: flex; gap: 10px; }
				.bottom-card {
					flex: 1; border: 1px solid var(--vscode-input-border); border-radius: 8px; padding: 12px;
					cursor: pointer; text-align: center; transition: all 0.15s;
				}
				.bottom-card:hover { border-color: var(--vscode-button-background); }
				.bottom-card.selected { border-color: var(--vscode-button-background); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
				.buttons { text-align: center; margin-top: 20px; }
				button {
					margin: 0 10px; padding: 10px 20px; border: none;
					background: var(--vscode-button-background); color: var(--vscode-button-foreground);
					border-radius: 4px; cursor: pointer; font-size: 14px;
				}
				button:disabled { opacity: 0.5; cursor: not-allowed; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="step-header">
					<h1>🎭 Choose Your Soul</h1>
					<p>Step 3 of 6: Pick an AI persona from the community</p>
				</div>

				<input class="search-bar" id="searchInput" type="text" placeholder="Search souls..." />
				<div class="filter-bar" id="filterBar">
					<span class="filter-btn active" data-cat="all">All</span>
				</div>

				<div class="soul-grid" id="soulGrid">
					<div class="loading">Loading souls from ClawSouls...</div>
				</div>

				<div class="bottom-options">
					<div class="bottom-card" data-choice="custom" onclick="selectBottom(this, 'custom')">
						<div style="font-size: 20px;">🎨</div>
						<div style="font-weight: 600; margin-top: 4px;">Create Custom</div>
					</div>
					<div class="bottom-card" data-choice="empty" onclick="selectBottom(this, 'empty')">
						<div style="font-size: 20px;">📄</div>
						<div style="font-weight: 600; margin-top: 4px;">Start Empty</div>
					</div>
				</div>

				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button id="nextBtn" onclick="next()" disabled>Next →</button>
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();
				let allSouls = [];
				let selectedSoul = null; // {owner, name} or 'custom' or 'empty'
				let activeCategory = 'all';

				// Request souls from extension
				vscode.postMessage({ type: 'fetchSouls' });

				window.addEventListener('message', event => {
					const msg = event.data;
					if (msg.type === 'soulsLoaded') {
						allSouls = msg.souls || [];
						// Sort by downloads desc
						allSouls.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
						buildFilters();
						renderSouls();
					}
					if (msg.type === 'soulApplied') {
						if (msg.success) {
							document.getElementById('nextBtn').disabled = false;
						}
					}
				});

				function buildFilters() {
					const cats = new Set();
					allSouls.forEach(s => cats.add(s.category || 'uncategorized'));
					const bar = document.getElementById('filterBar');
					bar.innerHTML = '<span class="filter-btn active" data-cat="all" onclick="setFilter(this, \\'all\\')">All</span>';
					[...cats].sort().forEach(c => {
						const btn = document.createElement('span');
						btn.className = 'filter-btn';
						btn.dataset.cat = c;
						btn.textContent = c;
						btn.onclick = function() { setFilter(this, c); };
						bar.appendChild(btn);
					});
				}

				function setFilter(el, cat) {
					activeCategory = cat;
					document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
					el.classList.add('active');
					renderSouls();
				}

				function renderSouls() {
					const q = (document.getElementById('searchInput').value || '').toLowerCase();
					let filtered = allSouls;
					if (activeCategory !== 'all') {
						filtered = filtered.filter(s => (s.category || 'uncategorized') === activeCategory);
					}
					if (q) {
						filtered = filtered.filter(s =>
							(s.displayName || '').toLowerCase().includes(q) ||
							(s.description || '').toLowerCase().includes(q) ||
							(s.tags || []).some(t => t.toLowerCase().includes(q)) ||
							(s.fullName || '').toLowerCase().includes(q)
						);
					}

					const grid = document.getElementById('soulGrid');
					if (filtered.length === 0) {
						grid.innerHTML = '<div class="loading">No souls found</div>';
						return;
					}
					grid.innerHTML = filtered.map((s, i) => {
						const scanIcon = s.scanStatus === 'pass' ? '✅' : s.scanStatus === 'warn' ? '⚠️' : '';
						const isTop = i < 3 && !q && activeCategory === 'all';
						return '<div class="soul-card" data-owner="' + s.owner + '" data-name="' + s.name + '" onclick="selectSoul(this)">' +
							(isTop ? '<span class="badge">⭐ Popular</span>' : '') +
							'<div class="name">' + (s.displayName || s.name) + '</div>' +
							'<div class="owner">' + (s.fullName || s.owner + '/' + s.name) + '</div>' +
							'<div class="desc">' + (s.description || '') + '</div>' +
							'<div class="meta">⬇ ' + (s.downloads || 0) + ' · v' + (s.version || '?') + ' ' + scanIcon + '</div>' +
						'</div>';
					}).join('');
				}

				document.getElementById('searchInput').addEventListener('input', renderSouls);

				function selectSoul(el) {
					document.querySelectorAll('.soul-card').forEach(c => c.classList.remove('selected'));
					document.querySelectorAll('.bottom-card').forEach(c => c.classList.remove('selected'));
					el.classList.add('selected');
					selectedSoul = { owner: el.dataset.owner, name: el.dataset.name };
					document.getElementById('nextBtn').disabled = false;
				}

				function selectBottom(el, choice) {
					document.querySelectorAll('.soul-card').forEach(c => c.classList.remove('selected'));
					document.querySelectorAll('.bottom-card').forEach(c => c.classList.remove('selected'));
					el.classList.add('selected');
					selectedSoul = choice;
					document.getElementById('nextBtn').disabled = false;
				}

				function next() {
					if (!selectedSoul) return;
					if (typeof selectedSoul === 'object') {
						// Apply the selected soul before moving to next step
						vscode.postMessage({ type: 'applySoul', data: selectedSoul });
					}
					vscode.postMessage({
						type: 'next',
						data: { soulChoice: typeof selectedSoul === 'string' ? selectedSoul : 'remote', soulOwner: selectedSoul.owner, soulName: selectedSoul.name }
					});
				}

				function back() {
					vscode.postMessage({ type: 'back' });
				}
			</script>
		</body>
		</html>
	`;
}

function getStep4TelegramHtml(): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>SoulClaw Setup - Telegram</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 30px; }
				.config-section {
					border: 1px solid var(--vscode-input-border);
					border-radius: 8px;
					padding: 20px;
					margin: 15px 0;
				}
				input[type="text"] {
					width: 100%;
					padding: 8px;
					border: 1px solid var(--vscode-input-border);
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					border-radius: 4px;
					margin-top: 8px;
					box-sizing: border-box;
				}
				.hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 6px; }
				.buttons { text-align: center; margin-top: 30px; }
				button {
					margin: 0 10px;
					padding: 10px 20px;
					border: none;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border-radius: 4px;
					cursor: pointer;
				}
				.test-btn {
					background: var(--vscode-button-secondaryBackground);
					color: var(--vscode-button-secondaryForeground);
					margin-top: 12px;
				}
				.test-result { margin-top: 10px; padding: 8px; border-radius: 4px; font-size: 13px; display: none; }
				.test-success { background: rgba(0,200,0,0.15); color: #4caf50; }
				.test-error { background: rgba(255,0,0,0.15); color: #f44336; }
				.steps-list { margin: 10px 0; padding-left: 20px; }
				.steps-list li { margin: 6px 0; }
				code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="step-header">
					<h1>🔗 Connect Telegram</h1>
					<p>Step 4 of 6: Get notifications via Telegram (optional)</p>
				</div>

				<div class="config-section">
					<h3>How to set up</h3>
					<ol class="steps-list">
						<li>Open Telegram and search for <code>@BotFather</code></li>
						<li>Send <code>/newbot</code> and follow the prompts</li>
						<li>Copy the bot token below</li>
						<li>Start a chat with your new bot, then send any message</li>
						<li>Click "Test Connection" to verify</li>
					</ol>
				</div>

				<div class="config-section">
					<h3>Bot Token</h3>
					<input type="text" id="botToken" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" />
					<div class="hint">From @BotFather after creating your bot</div>
				</div>

				<div class="config-section">
					<h3>Chat ID</h3>
					<input type="text" id="chatId" placeholder="123456789" />
					<div class="hint">Your Telegram user ID or group chat ID</div>

					<button class="test-btn" onclick="testConnection()">🔗 Test Connection</button>
					<div class="test-result" id="testResult"></div>
				</div>

				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button onclick="skipTelegram()">Skip</button>
					<button onclick="saveTelegram()">Save & Continue →</button>
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function testConnection() {
					const botToken = document.getElementById('botToken').value.trim();
					const chatId = document.getElementById('chatId').value.trim();
					if (!botToken) { showResult(false, 'Enter a bot token first'); return; }
					showResult(null, 'Testing...');
					vscode.postMessage({ type: 'testTelegram', data: { botToken, chatId } });
				}

				function showResult(success, text) {
					const el = document.getElementById('testResult');
					el.style.display = 'block';
					el.className = 'test-result ' + (success === null ? '' : success ? 'test-success' : 'test-error');
					el.textContent = text;
				}

				window.addEventListener('message', event => {
					const msg = event.data;
					if (msg.type === 'telegramTestResult') {
						if (msg.success) {
							showResult(true, '✅ Connected to bot: ' + msg.botName);
						} else {
							showResult(false, '❌ ' + (msg.error || 'Connection failed'));
						}
					}
				});

				function saveTelegram() {
					const botToken = document.getElementById('botToken').value.trim();
					const chatId = document.getElementById('chatId').value.trim();
					if (botToken && chatId) {
						vscode.postMessage({ type: 'saveTelegram', data: { botToken, chatId } });
					}
				}

				function skipTelegram() {
					vscode.postMessage({ type: 'next', data: {} });
				}

				function back() {
					vscode.postMessage({ type: 'back' });
				}
			</script>
		</body>
		</html>
	`;
}

function getStep5OllamaMemoryHtml(): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>SoulClaw Setup - Semantic Memory</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 30px; }
				.config-section {
					border: 1px solid var(--vscode-input-border);
					border-radius: 8px;
					padding: 20px;
					margin: 15px 0;
				}
				.recommended { color: var(--vscode-charts-green); font-weight: bold; }
				.hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 6px; line-height: 1.5; }
				.buttons { text-align: center; margin-top: 30px; }
				button {
					margin: 0 10px;
					padding: 10px 20px;
					border: none;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border-radius: 4px;
					cursor: pointer;
				}
				.status-box { margin-top: 12px; padding: 10px; border-radius: 6px; font-size: 13px; display: none; }
				.status-ok { background: rgba(0,200,0,0.12); color: #4caf50; display: block; }
				.status-err { background: rgba(255,200,0,0.12); color: #ff9800; display: block; }
				.status-loading { background: rgba(100,100,255,0.12); color: #90caf9; display: block; }
				.feature-list { margin: 12px 0; padding-left: 20px; }
				.feature-list li { margin: 6px 0; font-size: 13px; }
				code { background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px; }
			</style>
		</head>
		<body>
			<div class="container">
				<div class="step-header">
					<h1>🧠 Semantic Memory Search</h1>
					<p>Step 5 of 6: Enable AI-powered memory <span class="recommended">(Recommended)</span></p>
				</div>

				<div class="config-section">
					<h3>What is this?</h3>
					<p>SoulClaw can use a local embedding model to search your AI's memory semantically — not just keyword matching, but understanding meaning.</p>
					<ul class="feature-list">
						<li>🔍 <strong>Semantic search</strong> across MEMORY.md and memory files</li>
						<li>🌐 <strong>100+ languages</strong> supported (Korean, English, etc.)</li>
						<li>🔒 <strong>100% local</strong> — your data never leaves your machine</li>
						<li>⚡ <strong>Fast</strong> — runs on CPU, no GPU required</li>
					</ul>
				</div>

				<div class="config-section">
					<h3>Requirements</h3>
					<p>This requires <a href="https://ollama.com" style="color:var(--vscode-textLink-foreground)">Ollama</a> with the <code>bge-m3</code> embedding model (~670MB).</p>
					<div class="hint">If Ollama is already installed, click "Check & Install" to pull the model automatically.</div>

					<div style="margin-top: 16px; display: flex; gap: 10px;">
						<button onclick="checkOllama()" style="padding:8px 16px;">🔍 Check & Install</button>
					</div>
					<div class="status-box" id="statusBox"></div>
				</div>

				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button onclick="skipStep()">Skip</button>
					<button id="nextBtn" onclick="next()">Next →</button>
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function showStatus(cls, text) {
					const el = document.getElementById('statusBox');
					el.className = 'status-box ' + cls;
					el.innerHTML = text;
				}

				function checkOllama() {
					showStatus('status-loading', '⏳ Checking Ollama...');
					vscode.postMessage({ type: 'checkOllama' });
				}

				window.addEventListener('message', event => {
					const msg = event.data;
					if (msg.type === 'ollamaCheckResult') {
						if (msg.ollamaInstalled && msg.modelReady) {
							showStatus('status-ok', '✅ Ollama installed and bge-m3 model ready!');
						} else if (msg.ollamaInstalled && !msg.modelReady) {
							if (msg.pulling) {
								showStatus('status-loading', '⬇️ Pulling bge-m3 model... This may take a few minutes.');
							} else {
								showStatus('status-err', '⚠️ Ollama found but bge-m3 not installed. Click "Check & Install" to pull it.');
							}
						} else {
							showStatus('status-err', '⚠️ Ollama not found. <a href="https://ollama.com" style="color:inherit;text-decoration:underline;">Install Ollama</a> first, then try again.');
						}
					}
					if (msg.type === 'ollamaPullResult') {
						if (msg.success) {
							showStatus('status-ok', '✅ bge-m3 model installed successfully!');
						} else {
							showStatus('status-err', '❌ Failed to pull model: ' + (msg.error || 'Unknown error'));
						}
					}
				});

				function next() {
					vscode.postMessage({ type: 'next', data: {} });
				}

				function skipStep() {
					vscode.postMessage({ type: 'next', data: {} });
				}

				function back() {
					vscode.postMessage({ type: 'back' });
				}
			</script>
		</body>
		</html>
	`;
}

function getStep6CompleteHtml(): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>SoulClaw Setup - Complete</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; text-align: center; }
				.success-icon { font-size: 64px; margin-bottom: 20px; }
				.checkbox { margin: 15px 0; }
				input[type="checkbox"] { margin-right: 8px; }
				.buttons { margin-top: 30px; }
				button { 
					margin: 0 10px; 
					padding: 10px 20px; 
					border: none; 
					background: var(--vscode-button-background); 
					color: var(--vscode-button-foreground); 
					border-radius: 4px; 
					cursor: pointer; 
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="success-icon">🎉</div>
				<h1>Setup Complete!</h1>
				<p>SoulClaw is now ready to help you with soul-powered AI development.</p>
				
				<div class="checkbox">
					<input type="checkbox" id="openChat" checked />
					<label for="openChat">Open chat panel now</label>
				</div>
				
				<div class="buttons">
					<button onclick="finish()">Get Started!</button>
				</div>
			</div>
			
			<script>
				const vscode = acquireVsCodeApi();
				
				function finish() {
					const openChat = document.getElementById('openChat').checked;
					vscode.postMessage({
						type: 'finish',
						data: { openChat: openChat }
					});
				}
			</script>
		</body>
		</html>
	`;
}

async function checkOllamaSetup(panel: vscode.WebviewPanel): Promise<void> {
	const { execSync, exec } = require('child_process');
	
	// Check if Ollama is installed
	let ollamaInstalled = false;
	try {
		execSync('ollama --version', { encoding: 'utf8', timeout: 5000 });
		ollamaInstalled = true;
	} catch {}

	if (!ollamaInstalled) {
		panel.webview.postMessage({ type: 'ollamaCheckResult', ollamaInstalled: false, modelReady: false });
		return;
	}

	// Check if bge-m3 model is available
	let modelReady = false;
	try {
		const models = execSync('ollama list', { encoding: 'utf8', timeout: 10000 });
		modelReady = models.includes('bge-m3');
	} catch {}

	if (modelReady) {
		panel.webview.postMessage({ type: 'ollamaCheckResult', ollamaInstalled: true, modelReady: true });
		return;
	}

	// Model not found — pull it
	panel.webview.postMessage({ type: 'ollamaCheckResult', ollamaInstalled: true, modelReady: false, pulling: true });

	exec('ollama pull bge-m3', { timeout: 300000 }, (err: any) => {
		if (err) {
			panel.webview.postMessage({ type: 'ollamaPullResult', success: false, error: err.message });
		} else {
			panel.webview.postMessage({ type: 'ollamaPullResult', success: true });
		}
	});
}

/** Standalone Telegram setup — accessible from Command Palette */
export function setupTelegram(): void {
	const panel = vscode.window.createWebviewPanel(
		'clawsoulsTelegramSetup',
		'SoulClaw — Telegram Setup',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	);

	let html = getStep4TelegramHtml();
	// Adjust UI for standalone mode
	html = html.replace('Step 4 of 6: Get notifications via Telegram (optional)', 'Connect your Telegram bot');
	// Pre-fill existing config
	try {
		const fs = require('fs');
		const path = require('path');
		const { getStateDir } = require('../paths');
		const configPath = path.join(getStateDir(), 'config.yaml');
		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, 'utf8');
			const tokenMatch = content.match(/token:\s*['"]?([^\s'"]+)/);
			const chatMatch = content.match(/chatId:\s*['"]?([^\s'"]+)/);
			if (tokenMatch) html = html.replace('id="botToken" placeholder', `id="botToken" value="${tokenMatch[1]}" placeholder`);
			if (chatMatch) html = html.replace('id="chatId" placeholder', `id="chatId" value="${chatMatch[1]}" placeholder`);
		}
	} catch {}
	panel.webview.html = html;

	panel.webview.onDidReceiveMessage(async (message: any) => {
		switch (message.type) {
			case 'testTelegram':
				try {
					const result = await testTelegramConnection(message.data.botToken, message.data.chatId);
					panel.webview.postMessage({ type: 'telegramTestResult', success: true, botName: result });
				} catch (err: any) {
					panel.webview.postMessage({ type: 'telegramTestResult', success: false, error: err.message });
				}
				break;
			case 'saveTelegram':
				await saveTelegramConfig(message.data.botToken, message.data.chatId);
				try { await vscode.commands.executeCommand('clawsouls.restartTelegram'); } catch {}
				vscode.window.showInformationMessage('✅ Telegram connected and active!');
				panel.dispose();
				break;
			case 'next':
			case 'skip':
				panel.dispose();
				break;
		}
	});
}