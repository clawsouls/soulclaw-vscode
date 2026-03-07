/**
 * Tiered Bootstrap Loading — ported from SoulClaw
 * Loads workspace files in tiers for progressive context disclosure.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BootstrapFile, BootstrapTier } from './types';

const WORKSPACE_FILES = [
	'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md',
	'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'MEMORY.md'
];

const TIER_1 = new Set(['SOUL.md', 'IDENTITY.md', 'AGENTS.md']);
const TIER_2 = new Set(['TOOLS.md', 'USER.md', 'BOOTSTRAP.md']);
const TIER_3 = new Set(['MEMORY.md', 'HEARTBEAT.md']);

function getFileTier(name: string): BootstrapTier {
	if (TIER_1.has(name)) return 1;
	if (TIER_2.has(name)) return 2;
	if (TIER_3.has(name) || name.startsWith('memory/')) return 3;
	return 2;
}

export function loadWorkspaceFiles(workspaceDir: string): BootstrapFile[] {
	const files: BootstrapFile[] = [];

	for (const name of WORKSPACE_FILES) {
		const filePath = path.join(workspaceDir, name);
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			files.push({ name, path: filePath, content, missing: false });
		} catch {
			files.push({ name, path: filePath, missing: true });
		}
	}

	// Load memory/*.md files
	const memoryDir = path.join(workspaceDir, 'memory');
	try {
		const entries = fs.readdirSync(memoryDir);
		for (const entry of entries) {
			if (!entry.endsWith('.md')) continue;
			const name = `memory/${entry}`;
			const filePath = path.join(memoryDir, entry);
			try {
				const content = fs.readFileSync(filePath, 'utf-8');
				files.push({ name, path: filePath, content, missing: false });
			} catch {
				files.push({ name, path: filePath, missing: true });
			}
		}
	} catch {
		// memory/ dir doesn't exist
	}

	return files;
}

export interface TieredFilterOptions {
	turnCount?: number;
	isHeartbeat?: boolean;
	maxTier?: BootstrapTier;
}

export function filterByTier(files: BootstrapFile[], opts?: TieredFilterOptions): BootstrapFile[] {
	const turnCount = opts?.turnCount ?? 0;
	const isHeartbeat = opts?.isHeartbeat ?? false;

	if (opts?.maxTier === 3) return files;

	if (isHeartbeat) {
		return files.filter(f => TIER_1.has(f.name) || f.name === 'HEARTBEAT.md');
	}

	// First turn: Tier 1 + 2
	if (turnCount === 0) {
		const maxTier = opts?.maxTier ?? 2;
		return files.filter(f => getFileTier(f.name) <= maxTier);
	}

	// Continuation: Tier 1 only
	return files.filter(f => getFileTier(f.name) <= 1);
}

export function buildSystemPromptContext(files: BootstrapFile[]): string {
	const sections: string[] = [];

	for (const file of files) {
		if (file.missing) {
			sections.push(`## ${file.name}\n[MISSING] Expected at: ${file.path}`);
		} else if (file.content) {
			sections.push(`## ${file.name}\n${file.content}`);
		}
	}

	return sections.join('\n\n');
}
