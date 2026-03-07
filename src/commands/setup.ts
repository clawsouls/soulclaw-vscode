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
		const maxSteps = 4;
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
				case 'fetchSouls':
					try {
						const resp = await apiGet('/souls?limit=200');
						panel.webview.postMessage({ type: 'soulsLoaded', souls: resp.souls || [] });
					} catch {
						panel.webview.postMessage({ type: 'soulsLoaded', souls: [] });
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
	const detail = await apiGet(`/souls/${owner}/${name}?files=true`);
	const targetDir = getWorkspaceDirectory();
	fs.mkdirSync(targetDir, { recursive: true });

	const soulJson = {
		name: detail.name,
		displayName: detail.displayName,
		description: detail.description,
		version: detail.version,
		specVersion: '0.5',
		license: detail.license,
		tags: detail.tags,
		category: detail.category,
		author: detail.author,
		files: detail.files
	};

	const fileNames = Array.isArray(detail.files) ? detail.files as string[] : [];
	const fileContentsMap = detail.fileContents || {};
	const fileNameMap: Record<string, string> = {
		'soul': 'SOUL.md', 'identity': 'IDENTITY.md', 'style': 'STYLE.md',
		'agents': 'AGENTS.md', 'readme': 'README.md', 'heartbeat': 'HEARTBEAT.md',
		'user': 'USER.md', 'memory': 'MEMORY.md', 'tools': 'TOOLS.md', 'bootstrap': 'BOOTSTRAP.md'
	};

	fs.writeFileSync(path.join(targetDir, 'soul.json'), JSON.stringify(soulJson, null, 2));
	for (let i = 0; i < fileNames.length; i++) {
		const key = fileNames[i];
		const content = fileContentsMap[String(i)];
		if (!content || key === 'soul.json') continue;
		const filename = fileNameMap[key] || `${key.toUpperCase()}.md`;
		fs.writeFileSync(path.join(targetDir, filename), content);
	}
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
			return getStep4Html();
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
					<p>Step 1 of 4: Choose your LLM provider</p>
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
					<p>Step 2 of 4: Configure your local Ollama instance</p>
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
					<p>Step 2 of 4: Set up your ${providerName} API access</p>
				</div>

				<div class="auth-option">
					<h3>🔐 ${providerName} API Key</h3>
					<p>Enter your API key to get started:</p>
					<input type="password" id="apiKey" placeholder="${placeholder}" />
					<small>Your API key is stored securely in VSCode settings.</small>
				</div>

				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button onclick="next()">Next →</button>
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function next() {
					const apiKey = document.getElementById('apiKey').value;
					vscode.postMessage({
						type: 'next',
						data: { apiKey: apiKey }
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
					<p>Step 3 of 4: Pick an AI persona from the community</p>
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

function getStep4Html(): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>ClawSouls Setup - Complete</title>
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