import * as path from 'path';
import * as vscode from 'vscode';

let _stateDir: string | undefined;

/**
 * Initialize state dir from extension context.
 * Call once during activation.
 */
export function initStateDir(context: vscode.ExtensionContext): void {
	_stateDir = path.join(context.globalStorageUri.fsPath, 'soulclaw-state');
}

/**
 * Resolve the SoulClaw state directory.
 * In contained mode (VSCode extension): globalStorage/soulclaw-state/
 * Fallback: ~/.openclaw/ (shouldn't happen if initStateDir was called)
 */
export function getStateDir(): string {
	if (_stateDir) return _stateDir;
	const home = process.env.HOME || process.env.USERPROFILE || '';
	return path.join(home, '.openclaw');
}

/** Workspace dir: {stateDir}/workspace/ */
export function getWorkspaceDir(): string {
	return path.join(getStateDir(), 'workspace');
}

/** Swarm dir: {stateDir}/swarm/ */
export function getSwarmDir(): string {
	return path.join(getStateDir(), 'swarm');
}
