/**
 * Embedded SoulScan — lightweight soul file scanner.
 * Runs without external CLI dependency.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ScanResult {
	score: number;         // 0-100
	grade: string;         // A/B/C/D/F
	issues: ScanIssue[];
	fileCount: number;
}

export interface ScanIssue {
	severity: 'error' | 'warning' | 'info';
	rule: string;
	message: string;
	file?: string;
	line?: number;
}

const RULES = [
	// Security
	{ id: 'SEC-001', severity: 'error' as const, pattern: /sk-ant-[a-zA-Z0-9]+/, msg: 'Anthropic API key detected' },
	{ id: 'SEC-002', severity: 'error' as const, pattern: /sk-[a-zA-Z0-9]{20,}/, msg: 'Possible API key detected' },
	{ id: 'SEC-003', severity: 'error' as const, pattern: /password\s*[:=]\s*["'][^"']+["']/i, msg: 'Hardcoded password detected' },
	{ id: 'SEC-004', severity: 'warning' as const, pattern: /AKIA[0-9A-Z]{16}/, msg: 'AWS access key detected' },
	{ id: 'SEC-005', severity: 'error' as const, pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, msg: 'Private key detected' },
	
	// PII
	{ id: 'PII-001', severity: 'warning' as const, pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, msg: 'Phone number detected' },
	{ id: 'PII-002', severity: 'warning' as const, pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, msg: 'Email address detected' },
	
	// Quality
	{ id: 'QUA-001', severity: 'info' as const, pattern: /TODO|FIXME|HACK|XXX/i, msg: 'TODO/FIXME marker found' },
];

export function scanSoulFiles(workspaceDir: string): ScanResult {
	const soulFiles = ['soul.json', 'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'STYLE.md', 'HEARTBEAT.md', 'USER.md', 'TOOLS.md', 'MEMORY.md', 'BOOTSTRAP.md'];
	const issues: ScanIssue[] = [];
	let fileCount = 0;

	for (const fileName of soulFiles) {
		const filePath = path.join(workspaceDir, fileName);
		if (!fs.existsSync(filePath)) continue;
		fileCount++;

		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n');

		// Run rules
		for (const rule of RULES) {
			for (let i = 0; i < lines.length; i++) {
				if (rule.pattern.test(lines[i])) {
					issues.push({
						severity: rule.severity,
						rule: rule.id,
						message: rule.msg,
						file: fileName,
						line: i + 1,
					});
				}
			}
		}

		// Structure checks
		if (fileName === 'soul.json') {
			try {
				const json = JSON.parse(content);
				if (!json.name) issues.push({ severity: 'warning', rule: 'STR-001', message: 'soul.json missing "name" field', file: fileName });
				if (!json.specVersion) issues.push({ severity: 'warning', rule: 'STR-002', message: 'soul.json missing "specVersion" field', file: fileName });
				if (!json.description) issues.push({ severity: 'info', rule: 'STR-003', message: 'soul.json missing "description" field', file: fileName });
			} catch {
				issues.push({ severity: 'error', rule: 'STR-000', message: 'soul.json is not valid JSON', file: fileName });
			}
		}

		// File size check
		if (content.length > 50000) {
			issues.push({ severity: 'warning', rule: 'SIZ-001', message: `File exceeds 50KB (${(content.length/1024).toFixed(0)}KB)`, file: fileName });
		}
	}

	// Score calculation
	const errorCount = issues.filter(i => i.severity === 'error').length;
	const warnCount = issues.filter(i => i.severity === 'warning').length;
	const score = Math.max(0, 100 - errorCount * 20 - warnCount * 5);
	const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

	return { score, grade, issues, fileCount };
}
