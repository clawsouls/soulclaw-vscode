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

		// Check Node.js version (OpenClaw requires Node 22+)
		const nodePath = this.findSuitableNode();
		if (!nodePath) {
			const choice = await vscode.window.showErrorMessage(
				'OpenClaw requires Node.js 22+. Please install via nvm: `nvm install 24 && nvm use 24`',
				'Download Node.js'
			);
			if (choice === 'Download Node.js') {
				vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
			}
			return false;
		}
		outputChannel.appendLine(`Using Node: ${nodePath}`);

		// Ensure OpenClaw is installed in extension storage
		const openclawBin = await this.ensureInstalled(nodePath);
		if (!openclawBin) {
			return false;
		}

		return await this.startGateway(openclawBin, nodePath);
	}

	/**
	 * Find a Node.js 22+ binary. Checks: default PATH, nvm-windows, nvm-unix, fnm, volta.
	 */
	private findSuitableNode(): string | null {
		const isWin = process.platform === 'win32';
		const home = process.env.HOME || process.env.USERPROFILE || '';

		// Check candidates
		const candidates: string[] = ['node']; // default PATH first

		if (isWin) {
			// nvm-windows: C:\Users\USER\AppData\Roaming\nvm\v24.x.x\node.exe
			const nvmHome = process.env.NVM_HOME || path.join(process.env.APPDATA || '', 'nvm');
			try {
				const dirs = fs.readdirSync(nvmHome).filter(d => d.startsWith('v'));
				// Sort descending to prefer highest version
				dirs.sort((a, b) => {
					const va = parseInt(a.replace('v', '').split('.')[0]);
					const vb = parseInt(b.replace('v', '').split('.')[0]);
					return vb - va;
				});
				for (const d of dirs) {
					candidates.push(path.join(nvmHome, d, 'node.exe'));
				}
			} catch {}
			// volta
			const voltaNode = path.join(home, '.volta', 'bin', 'node.exe');
			candidates.push(voltaNode);
		} else {
			// nvm-unix: ~/.nvm/versions/node/v24.x.x/bin/node
			const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
			try {
				const versionsDir = path.join(nvmDir, 'versions', 'node');
				const dirs = fs.readdirSync(versionsDir).filter(d => d.startsWith('v'));
				dirs.sort((a, b) => {
					const va = parseInt(a.replace('v', '').split('.')[0]);
					const vb = parseInt(b.replace('v', '').split('.')[0]);
					return vb - va;
				});
				for (const d of dirs) {
					candidates.push(path.join(versionsDir, d, 'bin', 'node'));
				}
			} catch {}
			// fnm
			try {
				const fnmDir = path.join(home, '.local', 'share', 'fnm', 'node-versions');
				const dirs = fs.readdirSync(fnmDir).filter(d => d.startsWith('v'));
				dirs.sort((a, b) => {
					const va = parseInt(a.replace('v', '').split('.')[0]);
					const vb = parseInt(b.replace('v', '').split('.')[0]);
					return vb - va;
				});
				for (const d of dirs) {
					candidates.push(path.join(fnmDir, d, 'installation', 'bin', 'node'));
				}
			} catch {}
			// volta
			candidates.push(path.join(home, '.volta', 'bin', 'node'));
			// homebrew
			candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node');
		}

		for (const candidate of candidates) {
			try {
				const ver = execSync(`"${candidate}" --version`, {
					encoding: 'utf-8',
					timeout: 5000,
					windowsHide: true
				}).trim();
				const major = parseInt(ver.replace('v', '').split('.')[0]);
				if (major >= 22) {
					outputChannel.appendLine(`Found Node ${ver} at ${candidate}`);
					return candidate;
				}
			} catch {}
		}

		return null;
	}

	/**
	 * Install OpenClaw into extension's globalStorage (contained, no system pollution).
	 * Path: ~/.vscode/globalStorage/clawsouls.clawsouls-agent/openclaw/
	 */
	private async ensureInstalled(nodePath: string): Promise<string | null> {
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

				// Use npm from the same Node installation
				const nodeDir = path.dirname(nodePath);
				const npmCmd = isWin
					? path.join(nodeDir, 'npm.cmd')
					: path.join(nodeDir, 'npm');
				const npmFallback = isWin ? 'npm.cmd' : 'npm';
				const npm = fs.existsSync(npmCmd) ? `"${npmCmd}"` : npmFallback;

				outputChannel.appendLine(`Installing openclaw@${OPENCLAW_VERSION} into ${openclawDir}...`);
				outputChannel.appendLine(`Using npm: ${npm}`);

				// Install OpenClaw
				execSync(
					`${npm} install openclaw@${OPENCLAW_VERSION} --no-save --legacy-peer-deps`,
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

	private async startGateway(openclawBin: string, nodePath: string): Promise<boolean> {
		return new Promise((resolve) => {
			outputChannel.appendLine(`Starting Gateway on port ${this.port}...`);

			// Run openclaw via the specific Node binary to ensure correct version
			// openclawBin is a JS script, run it with: node <openclawBin> gateway start --port ...
			const openclawScript = openclawBin.replace(/\.cmd$/, '');
			const isWin = process.platform === 'win32';

			// On Windows, .cmd files are shell scripts. Use node directly with the JS entry point.
			const openclawDir = path.join(this.storagePath, 'openclaw');
			const jsEntry = path.join(openclawDir, 'node_modules', 'openclaw', 'dist', 'cli.mjs');
			const entryPoint = fs.existsSync(jsEntry) ? jsEntry : openclawBin;
			const useNodeDirect = fs.existsSync(jsEntry);

			const cmd = useNodeDirect ? nodePath : (isWin ? `"${openclawBin}"` : openclawBin);
			const args = useNodeDirect
				? [jsEntry, 'gateway', 'start', '--port', String(this.port)]
				: ['gateway', 'start', '--port', String(this.port)];

			outputChannel.appendLine(`Exec: ${cmd} ${args.join(' ')}`);

			this.process = spawn(cmd, args, {
				stdio: ['ignore', 'pipe', 'pipe'],
				detached: false,
				shell: isWin && !useNodeDirect,
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
