import * as vscode from 'vscode';

export async function setupWizard(): Promise<void> {
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
	const maxSteps = 5;

	panel.webview.onDidReceiveMessage(async (message) => {
		switch (message.type) {
			case 'next':
				await handleNextStep(panel, message.data, currentStep);
				currentStep++;
				break;
			case 'back':
				currentStep--;
				updateWebviewContent(panel, currentStep);
				break;
			case 'finish':
				await finishSetup(panel, message.data);
				panel.dispose();
				break;
			case 'skip':
				panel.dispose();
				break;
		}
	});

	updateWebviewContent(panel, currentStep);
}

async function handleNextStep(panel: vscode.WebviewPanel, data: any, step: number): Promise<void> {
	const config = vscode.workspace.getConfiguration('clawsouls');

	switch (step) {
		case 1:
			// Save LLM provider choice
			await config.update('llmProvider', data.provider, vscode.ConfigurationTarget.Global);
			break;
		case 2:
			// Save API key or handle OAuth
			if (data.apiKey) {
				await config.update('llmApiKey', data.apiKey, vscode.ConfigurationTarget.Global);
			}
			break;
		case 3:
			// Save gateway port
			if (data.port) {
				const url = `ws://127.0.0.1:${data.port}`;
				await config.update('gatewayUrl', url, vscode.ConfigurationTarget.Global);
			}
			break;
		case 4:
			// Handle soul selection
			if (data.soulChoice === 'custom') {
				await createCustomSoul(data.soulName);
			}
			break;
	}

	updateWebviewContent(panel, step + 1);
}

async function finishSetup(panel: vscode.WebviewPanel, data: any): Promise<void> {
	// Show completion message
	vscode.window.showInformationMessage('ClawSouls Agent setup completed! 🎉');

	// Auto-open chat if requested
	if (data.openChat) {
		vscode.commands.executeCommand('clawsouls.openChat');
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
		description: 'A custom soul created with ClawSouls Agent',
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

function updateWebviewContent(panel: vscode.WebviewPanel, step: number): void {
	panel.webview.html = getWebviewContent(step);
}

function getWebviewContent(step: number): string {
	switch (step) {
		case 1:
			return getStep1Html();
		case 2:
			return getStep2Html();
		case 3:
			return getStepPortHtml();
		case 4:
			return getStep3Html();
		case 5:
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
					<h1>🔮 Welcome to ClawSouls Agent</h1>
					<p>Step 1 of 5: Choose your LLM provider</p>
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

function getStep2Html(): string {
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
					<p>Step 2 of 5: Set up your API access</p>
				</div>
				
				<div class="auth-option">
					<h3>🔐 API Key</h3>
					<p>Enter your API key to get started:</p>
					<input type="password" id="apiKey" placeholder="sk-..." />
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

function getStepPortHtml(): string {
	return `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="UTF-8">
			<title>ClawSouls Setup - Step 3</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 30px; }
				.port-section {
					border: 1px solid var(--vscode-input-border);
					border-radius: 8px;
					padding: 20px;
					margin: 15px 0;
				}
				input[type="number"] {
					width: 200px;
					padding: 8px;
					border: 1px solid var(--vscode-input-border);
					background: var(--vscode-input-background);
					color: var(--vscode-input-foreground);
					border-radius: 4px;
					font-size: 16px;
				}
				.hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 8px; }
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
					<h1>🔌 Gateway Port</h1>
					<p>Step 3 of 5: Configure the OpenClaw Gateway connection</p>
				</div>

				<div class="port-section">
					<h3>Gateway Port</h3>
					<p>The extension connects to OpenClaw Gateway via WebSocket.</p>
					<input type="number" id="portInput" value="18789" min="1024" max="65535" />
					<div class="hint">Default: 18789. Change if you have multiple instances or a conflict.</div>
				</div>

				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button onclick="next()">Next →</button>
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				function next() {
					const port = document.getElementById('portInput').value;
					vscode.postMessage({
						type: 'next',
						data: { port: port }
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
			<title>ClawSouls Setup - Step 3</title>
			<style>
				body { font-family: var(--vscode-font-family); padding: 20px; }
				.container { max-width: 600px; margin: 0 auto; }
				.step-header { text-align: center; margin-bottom: 30px; }
				.soul-card { 
					border: 1px solid var(--vscode-input-border); 
					border-radius: 8px; 
					padding: 20px; 
					margin: 10px 0; 
					cursor: pointer; 
					transition: all 0.2s; 
				}
				.soul-card:hover { 
					border-color: var(--vscode-button-background); 
				}
				.soul-card.selected { 
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
				input { 
					width: 100%; 
					margin-top: 10px; 
					padding: 8px; 
					border: 1px solid var(--vscode-input-border); 
					background: var(--vscode-input-background); 
					color: var(--vscode-input-foreground); 
					border-radius: 4px; 
				}
			</style>
		</head>
		<body>
			<div class="container">
				<div class="step-header">
					<h1>🎭 Choose Your Soul</h1>
					<p>Step 4 of 5: Select an AI persona</p>
				</div>
				
				<div class="soul-card" data-choice="brad">
					<h3>👨‍💻 Brad - The Workflow Assistant</h3>
					<p>Organized, efficient, and great at project management and coding tasks.</p>
				</div>
				
				<div class="soul-card" data-choice="surgical">
					<h3>⚕️ Surgical Coder</h3>
					<p>Precise, methodical programmer focused on clean, maintainable code.</p>
				</div>
				
				<div class="soul-card" data-choice="custom">
					<h3>🎨 Custom Soul</h3>
					<p>Create your own AI persona tailored to your needs.</p>
					<input type="text" id="customName" placeholder="Enter soul name..." style="display: none;" />
				</div>
				
				<div class="soul-card" data-choice="empty">
					<h3>📄 Start Empty</h3>
					<p>Begin with no soul - you can add one later.</p>
				</div>
				
				<div class="buttons">
					<button onclick="back()">← Back</button>
					<button id="nextBtn" onclick="next()" disabled>Next →</button>
				</div>
			</div>
			
			<script>
				const vscode = acquireVsCodeApi();
				let selectedChoice = null;
				
				document.querySelectorAll('.soul-card').forEach(card => {
					card.addEventListener('click', () => {
						document.querySelectorAll('.soul-card').forEach(c => c.classList.remove('selected'));
						card.classList.add('selected');
						selectedChoice = card.dataset.choice;
						document.getElementById('nextBtn').disabled = false;
						
						const customInput = document.getElementById('customName');
						if (selectedChoice === 'custom') {
							customInput.style.display = 'block';
						} else {
							customInput.style.display = 'none';
						}
					});
				});
				
				function next() {
					if (selectedChoice) {
						const data = { soulChoice: selectedChoice };
						if (selectedChoice === 'custom') {
							data.soulName = document.getElementById('customName').value || 'Custom Soul';
						}
						vscode.postMessage({
							type: 'next',
							data: data
						});
					}
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
				<p>ClawSouls Agent is now ready to help you with soul-powered AI development.</p>
				
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