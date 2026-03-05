import * as vscode from 'vscode';
import { spawn, ChildProcess, execSync } from 'child_process';
import { outputChannel } from '../extension';

export class GatewayLauncher {
	private process: ChildProcess | null = null;
	private port: number;

	constructor(private context: vscode.ExtensionContext) {
		const config = vscode.workspace.getConfiguration('clawsouls');
		const url = config.get('gatewayUrl', 'ws://127.0.0.1:18789');
		const match = url.match(/:(\d+)$/);
		this.port = match ? parseInt(match[1]) : 18789;
	}

	public async ensureRunning(): Promise<boolean> {
		// Check if gateway is already running on the port
		if (await this.isPortOpen()) {
			outputChannel.appendLine(`Gateway already running on port ${this.port}`);
			return true;
		}

		// Find openclaw binary
		const openclawPath = this.findOpenclaw();
		if (!openclawPath) {
			const choice = await vscode.window.showWarningMessage(
				'OpenClaw not found. Install it to enable the AI agent.',
				'Install Guide',
				'Skip'
			);
			if (choice === 'Install Guide') {
				vscode.env.openExternal(vscode.Uri.parse('https://docs.openclaw.ai'));
			}
			return false;
		}

		outputChannel.appendLine(`Found OpenClaw at: ${openclawPath}`);
		return await this.startGateway(openclawPath);
	}

	private findOpenclaw(): string | null {
		try {
			// Check PATH
			const result = execSync('which openclaw 2>/dev/null || where openclaw 2>nul', {
				encoding: 'utf-8',
				timeout: 5000
			}).trim();
			if (result) return result.split('\n')[0];
		} catch {}

		// Common install locations
		const paths = [
			'/usr/local/bin/openclaw',
			'/opt/homebrew/bin/openclaw',
			`${process.env.HOME}/.nvm/versions/node/v24.13.0/bin/openclaw`,
			`${process.env.HOME}/.local/bin/openclaw`,
			`${process.env.APPDATA || ''}/npm/openclaw.cmd`,
		];

		for (const p of paths) {
			try {
				execSync(`test -f "${p}" 2>/dev/null || dir "${p}" 2>nul`, { timeout: 2000 });
				return p;
			} catch {}
		}

		// Try npx
		try {
			execSync('npx --yes openclaw --version', { encoding: 'utf-8', timeout: 10000 });
			return 'npx openclaw';
		} catch {}

		return null;
	}

	private async startGateway(openclawPath: string): Promise<boolean> {
		return new Promise((resolve) => {
			outputChannel.appendLine(`Starting OpenClaw Gateway on port ${this.port}...`);

			const isNpx = openclawPath.startsWith('npx');
			const cmd = isNpx ? 'npx' : openclawPath;
			const args = isNpx
				? ['openclaw', 'gateway', 'start', '--port', String(this.port)]
				: ['gateway', 'start', '--port', String(this.port)];

			this.process = spawn(cmd, args, {
				stdio: ['ignore', 'pipe', 'pipe'],
				detached: false,
				env: { ...process.env }
			});

			let started = false;

			this.process.stdout?.on('data', (data: Buffer) => {
				const line = data.toString().trim();
				outputChannel.appendLine(`[gateway] ${line}`);
				if (!started && (line.includes('listening') || line.includes('ready') || line.includes('started'))) {
					started = true;
					resolve(true);
				}
			});

			this.process.stderr?.on('data', (data: Buffer) => {
				const line = data.toString().trim();
				outputChannel.appendLine(`[gateway:err] ${line}`);
			});

			this.process.on('error', (err) => {
				outputChannel.appendLine(`Gateway process error: ${err.message}`);
				if (!started) resolve(false);
			});

			this.process.on('exit', (code) => {
				outputChannel.appendLine(`Gateway process exited (code: ${code})`);
				this.process = null;
				if (!started) resolve(false);
			});

			// Give it time to start, then try connecting anyway
			setTimeout(() => {
				if (!started) {
					outputChannel.appendLine('Gateway start timeout — attempting connection anyway');
					resolve(true);
				}
			}, 5000);
		});
	}

	private async isPortOpen(): Promise<boolean> {
		return new Promise((resolve) => {
			const net = require('net');
			const socket = new net.Socket();
			socket.setTimeout(1000);
			socket.on('connect', () => {
				socket.destroy();
				resolve(true);
			});
			socket.on('timeout', () => {
				socket.destroy();
				resolve(false);
			});
			socket.on('error', () => {
				resolve(false);
			});
			socket.connect(this.port, '127.0.0.1');
		});
	}

	public stop(): void {
		if (this.process) {
			outputChannel.appendLine('Stopping Gateway process...');
			this.process.kill('SIGTERM');
			this.process = null;
		}
	}

	public isRunning(): boolean {
		return this.process !== null && !this.process.killed;
	}
}
