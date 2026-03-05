import * as vscode from 'vscode';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { outputChannel } from '../extension';

const OPENCLAW_VERSION = '2026.2.9';

export class GatewayLauncher {
	private process: ChildProcess | null = null;
	private port: number;
	private storagePath: string;

	constructor(private context: vscode.ExtensionContext) {
		const config = vscode.workspace.getConfiguration('clawsouls');
		const url = config.get('gatewayUrl', 'ws://127.0.0.1:18789');
		const match = url.match(/:(\d+)$/);
		this.port = match ? parseInt(match[1]) : 18789;
		this.storagePath = context.globalStorageUri.fsPath;
	}

	public async ensureRunning(): Promise<boolean> {
		// Check if gateway is already running on the port
		if (await this.isPortOpen()) {
			outputChannel.appendLine(`Gateway already running on port ${this.port}`);
			return true;
		}

		// Ensure OpenClaw is installed in extension storage
		const openclawBin = await this.ensureInstalled();
		if (!openclawBin) {
			return false;
		}

		return await this.startGateway(openclawBin);
	}

	/**
	 * Install OpenClaw into extension's globalStorage (contained, no system pollution).
	 * Path: ~/.vscode/globalStorage/clawsouls.clawsouls-agent/openclaw/
	 */
	private async ensureInstalled(): Promise<string | null> {
		const openclawDir = path.join(this.storagePath, 'openclaw');
		const isWin = process.platform === 'win32';
		const binPath = isWin
			? path.join(openclawDir, 'node_modules', '.bin', 'openclaw.cmd')
			: path.join(openclawDir, 'node_modules', '.bin', 'openclaw');

		// Check if already installed with correct version
		if (fs.existsSync(binPath)) {
			try {
				const ver = execSync(`"${binPath}" --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
				if (ver.includes(OPENCLAW_VERSION)) {
					outputChannel.appendLine(`OpenClaw ${OPENCLAW_VERSION} ready (contained)`);
					return binPath;
				}
				outputChannel.appendLine(`OpenClaw version mismatch (${ver}), updating...`);
			} catch {
				outputChannel.appendLine('OpenClaw binary check failed, reinstalling...');
			}
		}

		// Install OpenClaw into contained directory
		return await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'ClawSouls Agent',
			cancellable: false
		}, async (progress) => {
			progress.report({ message: 'Installing OpenClaw runtime...' });

			try {
				// Create directory
				fs.mkdirSync(openclawDir, { recursive: true });

				// Create minimal package.json
				const pkg = { name: 'clawsouls-agent-runtime', version: '1.0.0', private: true };
				fs.writeFileSync(path.join(openclawDir, 'package.json'), JSON.stringify(pkg));

				// Find npm
				const npmCmd = isWin ? 'npm.cmd' : 'npm';

				outputChannel.appendLine(`Installing openclaw@${OPENCLAW_VERSION} into ${openclawDir}...`);

				// Install OpenClaw
				execSync(
					`${npmCmd} install openclaw@${OPENCLAW_VERSION} --no-save --prefer-offline`,
					{
						cwd: openclawDir,
						encoding: 'utf-8',
						timeout: 120000,
						env: { ...process.env },
						stdio: ['ignore', 'pipe', 'pipe']
					}
				);

				if (fs.existsSync(binPath)) {
					outputChannel.appendLine(`OpenClaw ${OPENCLAW_VERSION} installed successfully`);
					progress.report({ message: 'OpenClaw ready!' });
					return binPath;
				} else {
					outputChannel.appendLine('OpenClaw binary not found after install');
					return null;
				}
			} catch (err: any) {
				outputChannel.appendLine(`OpenClaw install failed: ${err.message}`);
				vscode.window.showErrorMessage(
					`Failed to install OpenClaw runtime. Check OUTPUT panel for details.`
				);
				return null;
			}
		});
	}

	private async startGateway(openclawBin: string): Promise<boolean> {
		return new Promise((resolve) => {
			outputChannel.appendLine(`Starting Gateway on port ${this.port}...`);

			const isWin = process.platform === 'win32';
			const cmd = isWin ? `"${openclawBin}"` : openclawBin;

			this.process = spawn(cmd, ['gateway', 'start', '--port', String(this.port)], {
				stdio: ['ignore', 'pipe', 'pipe'],
				detached: false,
				shell: isWin,
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
				outputChannel.appendLine(`Gateway exited (code: ${code})`);
				this.process = null;
				if (!started) resolve(false);
			});

			// Timeout — try connecting anyway
			setTimeout(() => {
				if (!started) {
					outputChannel.appendLine('Gateway start timeout — attempting connection');
					resolve(true);
				}
			}, 8000);
		});
	}

	private async isPortOpen(): Promise<boolean> {
		return new Promise((resolve) => {
			const net = require('net');
			const socket = new net.Socket();
			socket.setTimeout(1000);
			socket.on('connect', () => { socket.destroy(); resolve(true); });
			socket.on('timeout', () => { socket.destroy(); resolve(false); });
			socket.on('error', () => { resolve(false); });
			socket.connect(this.port, '127.0.0.1');
		});
	}

	public stop(): void {
		if (this.process) {
			outputChannel.appendLine('Stopping Gateway...');
			this.process.kill('SIGTERM');
			this.process = null;
		}
	}

	public isRunning(): boolean {
		return this.process !== null && !this.process.killed;
	}
}
