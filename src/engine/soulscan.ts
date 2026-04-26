/**
 * Embedded SoulScan — lightweight soul file scanner.
 *
 * Implements a multi-layer contamination detection pipeline. Each scan
 * can traverse up to four independent detection layers over the same
 * soul file corpus:
 *
 *   1. SECURITY  (53 rules, pattern) — prompt injection, code
 *                                      execution, XSS, exfiltration,
 *                                      secrets, harmful content
 *   2. PII       ( 2 rules, pattern) — phone, email
 *   3. QUALITY   (11 rules, structural) — schema/shape checks on
 *                                        soul.json and SOUL.md
 *   4. INTEGRITY (hash, opt-in) — SHA-256 comparison against an
 *                                caller-provided expected-hashes map;
 *                                detects post-checkpoint tampering
 *                                even when the content still passes
 *                                the three pattern/structural layers
 *
 * Layers 1–3 always run. Layer 4 only activates when the caller
 * passes `expectedHashes` — typically from a `checkpoint.json`
 * manifest emitted by `checkpointPanel.createCheckpoint()`. The
 * layer count in the returned `categories` object always includes
 * all four keys (zero-filled when inactive) so downstream UI can
 * render a consistent "4-layer" badge matching the Marketplace
 * README statement "Run 4-layer contamination detection on any
 * checkpoint".
 *
 * The layers are intentionally kept separate so a consumer can tell
 * *what kind* of contamination fired, which the auto-restore flow
 * relies on when diffing two checkpoints to identify the first
 * contamination point.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ScanResult {
	score: number;         // 0-100
	grade: string;         // A/B/C/D/F
	issues: ScanIssue[];
	fileCount: number;
	categories: { security: number; quality: number; pii: number; integrity: number };
}

export interface ScanIssue {
	severity: 'error' | 'warning' | 'info';
	rule: string;
	message: string;
	file?: string;
	line?: number;
	category: 'security' | 'quality' | 'pii' | 'integrity';
}

export interface ScanOptions {
	/**
	 * Expected SHA-256 (hex) per soul-file. Typically the `hashes` map
	 * pulled from a checkpoint's `checkpoint.json`. When provided, the
	 * integrity layer runs and emits `INT001` for any file whose
	 * current bytes hash to a different value than the expected entry.
	 * Files present in the workspace but not listed in the map are
	 * ignored (integrity is an opt-in comparison, not a coverage
	 * check).
	 */
	expectedHashes?: Record<string, string>;
}

/* ── Layer 1: Security rules (53, from scan-rules v1.2.0) ─────────────── */

const SECURITY_RULES: { id: string; severity: 'error' | 'warning'; pattern: RegExp; msg: string }[] = [
	// Prompt injection
	{ id: 'SEC001', severity: 'error', pattern: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts)/i, msg: 'Prompt injection: ignore previous instructions' },
	{ id: 'SEC002', severity: 'error', pattern: /you\s+are\s+now\s+(?:a|an|the)\s+/i, msg: 'Prompt injection: forced role change' },
	{ id: 'SEC003', severity: 'error', pattern: /disregard\s+(?:your|all|previous)/i, msg: 'Prompt injection: disregard instructions' },
	{ id: 'SEC004', severity: 'error', pattern: /forget\s+(?:all|your|previous)\s+(?:instructions|rules|constraints)/i, msg: 'Prompt injection: forget instructions' },
	{ id: 'SEC005', severity: 'error', pattern: /override\s+(?:your|all|system)\s+(?:instructions|rules|settings)/i, msg: 'Prompt injection: override system' },
	{ id: 'SEC006', severity: 'error', pattern: /(?:pretend|act\s+as\s+if)\s+(?:you\s+)?(?:have\s+no|don'?t\s+have)\s+(?:rules|restrictions|limits)/i, msg: 'Prompt injection: remove restrictions' },
	{ id: 'SEC007', severity: 'error', pattern: /jailbreak|DAN\s*mode|do\s+anything\s+now/i, msg: 'Prompt injection: jailbreak attempt' },
	{ id: 'SEC008', severity: 'error', pattern: /\[system\]|\[INST\]|<<SYS>>|<\|im_start\|>/, msg: 'Prompt injection: system token injection' },
	// Code execution
	{ id: 'SEC010', severity: 'error', pattern: /eval\s*\(/, msg: 'Code execution: eval()' },
	{ id: 'SEC011', severity: 'error', pattern: /exec\s*\(/, msg: 'Code execution: exec()' },
	{ id: 'SEC012', severity: 'error', pattern: /system\s*\(/, msg: 'Code execution: system()' },
	{ id: 'SEC013', severity: 'error', pattern: /child_process/, msg: 'Code execution: child_process module' },
	{ id: 'SEC014', severity: 'error', pattern: /require\s*\(\s*['"`](?:fs|net|http|child_process)/, msg: 'Code execution: dangerous require' },
	{ id: 'SEC015', severity: 'error', pattern: /import\s+.*from\s+['"`](?:fs|net|http|child_process)/, msg: 'Code execution: dangerous import' },
	// XSS
	{ id: 'SEC020', severity: 'error', pattern: /<script[\s>]/, msg: 'XSS: script tag' },
	{ id: 'SEC021', severity: 'error', pattern: /on(?:load|error|click|mouseover)\s*=/, msg: 'XSS: event handler attribute' },
	{ id: 'SEC022', severity: 'error', pattern: /javascript\s*:/, msg: 'XSS: javascript: URI' },
	// Data exfiltration & secrets
	{ id: 'SEC030', severity: 'error', pattern: /(?:curl|wget|fetch)\s+https?:\/\//, msg: 'Data exfiltration: external HTTP request' },
	{ id: 'SEC031', severity: 'error', pattern: /(?:api[_-]?key|secret[_-]?key|password|token)\s*[=:]\s*['"`]/, msg: 'Secret exposure: hardcoded credential' },
	{ id: 'SEC032', severity: 'warning', pattern: /base64[_-]?(?:encode|decode)|atob|btoa/, msg: 'Obfuscation: base64 encoding' },
	// Privilege escalation / destructive
	{ id: 'SEC040', severity: 'error', pattern: /sudo\s+/, msg: 'Privilege escalation: sudo command' },
	{ id: 'SEC041', severity: 'error', pattern: /chmod\s+(?:777|u\+s)/, msg: 'Privilege escalation: dangerous chmod' },
	{ id: 'SEC042', severity: 'error', pattern: /rm\s+-rf\s+[\/~]/, msg: 'Destructive command: rm -rf' },
	// Social engineering
	{ id: 'SEC050', severity: 'warning', pattern: /(?:send|share|reveal|tell\s+me)\s+(?:your|the)\s+(?:api[_-]?key|password|token|secret|credentials)/i, msg: 'Social engineering: credential request' },
	{ id: 'SEC051', severity: 'warning', pattern: /(?:don'?t|do\s+not)\s+(?:tell|inform|alert|notify)\s+(?:the\s+)?(?:user|human|operator)/i, msg: 'Social engineering: hide from user' },
	// Specific secret patterns
	{ id: 'SEC060', severity: 'error', pattern: /AKIA[0-9A-Z]{16}/, msg: 'Secret: AWS Access Key' },
	{ id: 'SEC061', severity: 'error', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/, msg: 'Secret: GitHub Token' },
	{ id: 'SEC062', severity: 'error', pattern: /xox[bpras]-[A-Za-z0-9-]+/, msg: 'Secret: Slack Token' },
	{ id: 'SEC063', severity: 'error', pattern: /-----BEGIN (?:RSA|EC|PRIVATE) KEY-----/, msg: 'Secret: Private Key' },
	{ id: 'SEC064', severity: 'error', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ/, msg: 'Secret: JWT Token' },
	{ id: 'SEC065', severity: 'error', pattern: /npm_[A-Za-z0-9]{36}/, msg: 'Secret: npm Token' },
	{ id: 'SEC066', severity: 'error', pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/, msg: 'Secret: OpenAI API Key' },
	{ id: 'SEC067', severity: 'error', pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/, msg: 'Secret: SendGrid API Key' },
	{ id: 'SEC068', severity: 'error', pattern: /sk_live_[A-Za-z0-9]{24,}/, msg: 'Secret: Stripe Secret Key' },
	{ id: 'SEC069', severity: 'warning', pattern: /['"`][A-Za-z0-9]{40,}['"`]/, msg: 'Possible hardcoded secret (40+ chars)' },
	// Korean prompt injection
	{ id: 'SEC070', severity: 'error', pattern: /이전\s*지시를\s*무시/, msg: 'Prompt injection (KO): ignore previous instructions' },
	{ id: 'SEC071', severity: 'error', pattern: /모든\s*규칙을\s*잊어/, msg: 'Prompt injection (KO): forget all rules' },
	{ id: 'SEC072', severity: 'error', pattern: /시스템\s*프롬프트를\s*보여/, msg: 'Prompt injection (KO): show system prompt' },
	// Chinese prompt injection
	{ id: 'SEC073', severity: 'error', pattern: /忽略之前的指令/, msg: 'Prompt injection (ZH): ignore previous instructions' },
	{ id: 'SEC074', severity: 'error', pattern: /忘记所有规则/, msg: 'Prompt injection (ZH): forget all rules' },
	{ id: 'SEC075', severity: 'error', pattern: /显示系统提示/, msg: 'Prompt injection (ZH): show system prompt' },
	// Japanese prompt injection
	{ id: 'SEC076', severity: 'error', pattern: /以前の指示を無視/, msg: 'Prompt injection (JA): ignore previous instructions' },
	{ id: 'SEC077', severity: 'error', pattern: /すべてのルールを忘れて/, msg: 'Prompt injection (JA): forget all rules' },
	// Harmful content
	{ id: 'SEC080', severity: 'error', pattern: /\b(kill|murder|assassinate)\s+(all|every|the)\s+(humans?|people|users?|jews?|muslims?|blacks?|whites?)/i, msg: 'Harmful content: violence targeting groups' },
	{ id: 'SEC081', severity: 'error', pattern: /\b(white|black|asian|jewish)\s+supremac/i, msg: 'Harmful content: supremacist ideology' },
	{ id: 'SEC082', severity: 'error', pattern: /\b(pretend|act|behave)\s+(to\s+be|as\s+if|like)\s+(you\s+are\s+)?(elon\s+musk|sam\s+altman|mark\s+zuckerberg|donald\s+trump|joe\s+biden)/i, msg: 'Harmful content: public figure impersonation' },
	{ id: 'SEC083', severity: 'warning', pattern: /\b(bypass|circumvent|evade|disable)\s+(safety|content|ethical|moral)\s+(filter|guard|check|restriction|guideline)/i, msg: 'Harmful content: safety bypass instruction' },
	{ id: 'SEC084', severity: 'error', pattern: /\b(how\s+to\s+)?(make|build|create|synthesize)\s+(a\s+)?(bomb|explosive|weapon|poison|drug|meth)/i, msg: 'Harmful content: dangerous instructions' },
	{ id: 'SEC085', severity: 'error', pattern: /\b(hate|despise|exterminate)\s+(all\s+)?(women|men|gay|lesbian|trans|disabled|immigrants?)/i, msg: 'Harmful content: hate speech targeting demographics' },
	{ id: 'SEC086', severity: 'warning', pattern: /\byou\s+must\s+(always|never)\s+(lie|deceive|manipulate|mislead)\s+(the\s+)?user/i, msg: 'Harmful content: deception instruction' },
	{ id: 'SEC087', severity: 'error', pattern: /\b(child|minor|underage)\s+(porn|sexual|abuse|exploit)/i, msg: 'Harmful content: CSAM-related' },
	{ id: 'SEC088', severity: 'warning', pattern: /\b(phishing|scam|fraud)\s+(email|message|template|script)/i, msg: 'Harmful content: fraud/scam template' },
	{ id: 'SEC089', severity: 'warning', pattern: /\bno\s+(ethical|moral|safety)\s+(constraints?|guidelines?|boundaries|limits?)/i, msg: 'Harmful content: no ethical constraints declaration' },
];

/* ── Layer 2: PII rules (2) ──────────────────────────────────────────── */

// Kept separate from SECURITY_RULES so the UI's contamination-layer
// breakdown can render / reason about PII independently from
// prompt-injection / code-execution findings.
const PII_RULES: { id: string; severity: 'error' | 'warning'; pattern: RegExp; msg: string }[] = [
	{ id: 'PII001', severity: 'warning', pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, msg: 'Phone number detected' },
	{ id: 'PII002', severity: 'warning', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, msg: 'Email address detected' },
];

/* ── Scan entry point ─────────────────────────────────────────────────── */

const SOUL_FILES = ['soul.json', 'SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'STYLE.md', 'HEARTBEAT.md', 'USER.md', 'TOOLS.md', 'MEMORY.md', 'BOOTSTRAP.md'];

export function scanSoulFiles(workspaceDir: string, options: ScanOptions = {}): ScanResult {
	const issues: ScanIssue[] = [];
	let fileCount = 0;
	let soulJsonContent: string | null = null;
	let soulMdContent: string | null = null;
	let soulMdExists = false;

	for (const fileName of SOUL_FILES) {
		const filePath = path.join(workspaceDir, fileName);
		if (!fs.existsSync(filePath)) continue;
		fileCount++;

		const content = fs.readFileSync(filePath, 'utf-8');
		const lines = content.split('\n');

		// ── Layer 4: Integrity (opt-in, hash comparison) ──
		// Only fires when the caller supplied an expected-hash map
		// (typically from a checkpoint.json manifest). Detects
		// post-checkpoint tampering that can't be caught by the
		// three pattern/structural layers — e.g. a silent byte
		// swap that changes semantics without introducing new
		// tokens that match SEC/PII/QUA rules.
		if (options.expectedHashes && Object.prototype.hasOwnProperty.call(options.expectedHashes, fileName)) {
			const expected = options.expectedHashes[fileName];
			const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
			if (actual !== expected) {
				issues.push({
					severity: 'error',
					rule: 'INT001',
					message: `Hash mismatch — file modified since checkpoint (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
					file: fileName,
					category: 'integrity',
				});
			}
		}

		if (fileName === 'soul.json') { soulJsonContent = content; }
		if (fileName === 'SOUL.md') { soulMdContent = content; soulMdExists = true; }

		// ── Layer 1: Security rules (line-by-line) ──
		for (const rule of SECURITY_RULES) {
			for (let i = 0; i < lines.length; i++) {
				if (rule.pattern.test(lines[i])) {
					issues.push({
						severity: rule.severity,
						rule: rule.id,
						message: rule.msg,
						file: fileName,
						line: i + 1,
						category: 'security',
					});
				}
			}
		}

		// ── Layer 2: PII rules (line-by-line) ──
		for (const rule of PII_RULES) {
			for (let i = 0; i < lines.length; i++) {
				if (rule.pattern.test(lines[i])) {
					issues.push({
						severity: rule.severity,
						rule: rule.id,
						message: rule.msg,
						file: fileName,
						line: i + 1,
						category: 'pii',
					});
				}
			}
		}

		// ── Layer 3: Quality rules (per-file, inline) ──
		// QUA-006: File size > 50KB ──
		if (content.length > 50000) {
			issues.push({ severity: 'warning', rule: 'QUA-006', message: `File exceeds 50KB (${(content.length / 1024).toFixed(0)}KB)`, file: fileName, category: 'quality' });
		}

		// ── QUA-007: TODO/FIXME markers ──
		for (let i = 0; i < lines.length; i++) {
			if (/TODO|FIXME|HACK|XXX/i.test(lines[i])) {
				issues.push({ severity: 'info', rule: 'QUA-007', message: 'TODO/FIXME marker found', file: fileName, line: i + 1, category: 'quality' });
			}
		}
	}

	// ── Quality: soul.json checks ──
	if (soulJsonContent !== null) {
		try {
			const json = JSON.parse(soulJsonContent);
			if (!json.name) {
				issues.push({ severity: 'warning', rule: 'QUA-001', message: 'soul.json missing "name" field', file: 'soul.json', category: 'quality' });
			}
			if (!json.specVersion) {
				issues.push({ severity: 'warning', rule: 'QUA-002', message: 'soul.json missing "specVersion" field', file: 'soul.json', category: 'quality' });
			}
			if (!json.description) {
				issues.push({ severity: 'info', rule: 'QUA-003', message: 'soul.json missing "description" field', file: 'soul.json', category: 'quality' });
			}
			if (!json.persona) {
				issues.push({ severity: 'warning', rule: 'QUA-009', message: 'soul.json missing "persona" field', file: 'soul.json', category: 'quality' });
			}
		} catch {
			issues.push({ severity: 'error', rule: 'QUA-000', message: 'soul.json is not valid JSON', file: 'soul.json', category: 'quality' });
		}
	}

	// ── Quality: SOUL.md checks ──
	if (!soulMdExists) {
		issues.push({ severity: 'warning', rule: 'QUA-004', message: 'No SOUL.md — personality undefined', category: 'quality' });
	} else if (soulMdContent !== null) {
		// QUA-005: no ## sections
		if (!/^##\s+/m.test(soulMdContent)) {
			issues.push({ severity: 'info', rule: 'QUA-005', message: 'No structured sections in SOUL.md', file: 'SOUL.md', category: 'quality' });
		}
		// QUA-008: no safety constraints section
		if (!/^##.*(?:Never|Constraints?|Restrictions?)/mi.test(soulMdContent)) {
			issues.push({ severity: 'info', rule: 'QUA-008', message: 'No safety constraints defined', file: 'SOUL.md', category: 'quality' });
		}
		// QUA-010: very short
		if (soulMdContent.length < 200) {
			issues.push({ severity: 'info', rule: 'QUA-010', message: 'Very short persona definition (<200 chars)', file: 'SOUL.md', category: 'quality' });
		}
	}

	// ── Score calculation: error=-15, warning=-5, info=-1 ──
	const errorCount = issues.filter(i => i.severity === 'error').length;
	const warnCount = issues.filter(i => i.severity === 'warning').length;
	const infoCount = issues.filter(i => i.severity === 'info').length;
	const score = Math.max(0, 100 - errorCount * 15 - warnCount * 5 - infoCount * 1);
	// Grade bands aligned with WasmClaw's ScanResult grading (see
	// wasmclaw@0.5.0 src/scan/scanner.ts) so the same persona lands in
	// the same band whether scanned here or via the engine library.
	const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 50 ? 'C' : score >= 25 ? 'D' : 'F';

	const securityCount = issues.filter(i => i.category === 'security').length;
	const qualityCount = issues.filter(i => i.category === 'quality').length;
	const piiCount = issues.filter(i => i.category === 'pii').length;
	const integrityCount = issues.filter(i => i.category === 'integrity').length;

	return {
		score,
		grade,
		issues,
		fileCount,
		categories: {
			security: securityCount,
			quality: qualityCount,
			pii: piiCount,
			integrity: integrityCount,
		},
	};
}
