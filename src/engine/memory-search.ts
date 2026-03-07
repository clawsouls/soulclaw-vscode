/**
 * Lightweight memory search — TF-IDF based (no vector DB dependency).
 * Searches MEMORY.md and memory/*.md files for relevant context.
 */

import * as fs from 'fs';
import * as path from 'path';

interface SearchResult {
	file: string;
	line: number;
	text: string;
	score: number;
}

/** Tokenize text into lowercase words */
function tokenize(text: string): string[] {
	return text.toLowerCase().replace(/[^a-zA-Z0-9가-힣\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

/** Simple TF-IDF-like scoring */
function score(query: string[], tokens: string[]): number {
	if (tokens.length === 0) return 0;
	let matches = 0;
	const tokenSet = new Set(tokens);
	for (const q of query) {
		if (tokenSet.has(q)) matches++;
	}
	return matches / Math.max(query.length, 1);
}

/** Search memory files for relevant content */
export function searchMemory(workspaceDir: string, query: string, maxResults: number = 5): SearchResult[] {
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return [];

	const results: SearchResult[] = [];

	// Collect all memory files
	const files: string[] = [];
	const memoryMd = path.join(workspaceDir, 'MEMORY.md');
	if (fs.existsSync(memoryMd)) files.push(memoryMd);

	const memoryDir = path.join(workspaceDir, 'memory');
	try {
		const entries = fs.readdirSync(memoryDir);
		for (const e of entries) {
			if (e.endsWith('.md')) files.push(path.join(memoryDir, e));
		}
	} catch {}

	// Search each file
	for (const filePath of files) {
		try {
			const content = fs.readFileSync(filePath, 'utf-8');
			const lines = content.split('\n');
			const fileName = path.relative(workspaceDir, filePath);

			// Sliding window of 3 lines for context
			for (let i = 0; i < lines.length; i++) {
				const window = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 2)).join(' ');
				const tokens = tokenize(window);
				const s = score(queryTokens, tokens);
				if (s > 0.2) {
					results.push({
						file: fileName,
						line: i + 1,
						text: lines[i].trim(),
						score: s,
					});
				}
			}
		} catch {}
	}

	// Sort by score descending, deduplicate, limit
	results.sort((a, b) => b.score - a.score);
	
	// Deduplicate nearby lines
	const deduped: SearchResult[] = [];
	for (const r of results) {
		const isDup = deduped.some(d => d.file === r.file && Math.abs(d.line - r.line) < 3);
		if (!isDup) deduped.push(r);
		if (deduped.length >= maxResults) break;
	}

	return deduped;
}
