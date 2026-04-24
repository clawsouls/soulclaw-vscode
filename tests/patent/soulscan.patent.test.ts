/**
 * Patent test — APP2026-0325 claim component ③ (multi-layer
 * contamination detection).
 *
 * Asserts that `scanSoulFiles()` fires each of the three contamination
 * layers (SEC / PII / QUA) against the `contaminated-soul` fixture and
 * none against the `clean-soul` fixture, and that the resulting score
 * lands in the expected grade band on each side.
 *
 * Run from the repo root with:
 *
 *     npx tsx tests/patent/soulscan.patent.test.ts
 *
 * `tsx` is zero-install via npx — no devDependency change needed.
 * Exit code 0 = all passed; non-zero = at least one assertion failed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import { scanSoulFiles } from '../../src/engine/soulscan';

const FIXTURE_ROOT = path.join(__dirname, 'fixtures');
const CLEAN = path.join(FIXTURE_ROOT, 'clean-soul');
const DIRTY = path.join(FIXTURE_ROOT, 'contaminated-soul');

test('clean soul: zero security, zero PII, A-band score', () => {
	const r = scanSoulFiles(CLEAN);

	assert.equal(r.categories.security, 0, 'expected no security findings on clean fixture');
	assert.equal(r.categories.pii, 0, 'expected no PII findings on clean fixture');
	assert.equal(r.categories.integrity, 0, 'expected no integrity findings when expectedHashes not provided');
	assert.ok(r.score >= 90, `expected A-band (>=90), got ${r.score}`);
	assert.equal(r.grade, 'A', `expected grade A, got ${r.grade}`);
});

test('integrity layer: no-op when expectedHashes not provided', () => {
	const r = scanSoulFiles(CLEAN);
	assert.equal(r.categories.integrity, 0);
	assert.ok(!r.issues.some(i => i.rule.startsWith('INT')), 'INT* rule must not fire without expectedHashes');
});

test('integrity layer: fires INT001 on hash mismatch', () => {
	// Pass a deliberately wrong expected hash for soul.json.
	const r = scanSoulFiles(CLEAN, {
		expectedHashes: {
			'soul.json': '0'.repeat(64),
			'SOUL.md': '0'.repeat(64),
		},
	});
	assert.ok(r.categories.integrity >= 1, `expected >=1 INT finding, got ${r.categories.integrity}`);
	const intIssues = r.issues.filter(i => i.category === 'integrity');
	assert.ok(intIssues.every(i => i.rule === 'INT001'), 'integrity issues must use INT001');
	assert.ok(intIssues.every(i => i.severity === 'error'), 'INT001 must be error severity');
});

test('integrity layer: passes when expected hash matches actual', () => {
	// Compute real hashes of the clean fixture, then pass them back.
	const soulJsonBytes = require('fs').readFileSync(path.join(CLEAN, 'soul.json'));
	const soulMdBytes = require('fs').readFileSync(path.join(CLEAN, 'SOUL.md'));
	const hash = (b: Buffer) => require('crypto').createHash('sha256').update(b).digest('hex');
	const r = scanSoulFiles(CLEAN, {
		expectedHashes: {
			'soul.json': hash(soulJsonBytes),
			'SOUL.md': hash(soulMdBytes),
		},
	});
	assert.equal(r.categories.integrity, 0, 'integrity layer should not fire when hashes match');
});

test('contaminated soul: SEC layer fires', () => {
	const r = scanSoulFiles(DIRTY);

	assert.ok(r.categories.security >= 3, `expected >=3 SEC findings, got ${r.categories.security}`);
	const secRules = r.issues.filter(i => i.category === 'security').map(i => i.rule);
	assert.ok(
		secRules.some(id => id.startsWith('SEC')),
		'expected at least one SEC* rule id among security findings'
	);
});

test('contaminated soul: PII layer fires with correct category', () => {
	const r = scanSoulFiles(DIRTY);

	assert.ok(r.categories.pii >= 2, `expected >=2 PII findings, got ${r.categories.pii}`);
	const piiIssues = r.issues.filter(i => i.category === 'pii');
	assert.ok(
		piiIssues.some(i => i.rule === 'PII001'),
		'expected PII001 (phone) to fire on contaminated fixture'
	);
	assert.ok(
		piiIssues.some(i => i.rule === 'PII002'),
		'expected PII002 (email) to fire on contaminated fixture'
	);
});

test('contaminated soul: QUA layer fires via structural checks', () => {
	const r = scanSoulFiles(DIRTY);

	assert.ok(r.categories.quality >= 1, `expected >=1 QUA finding, got ${r.categories.quality}`);
	const quaIssues = r.issues.filter(i => i.category === 'quality');
	assert.ok(quaIssues.every(i => i.rule.startsWith('QUA')), 'all quality-category issues should have QUA* rule ids');
});

test('multi-layer separation: rule-id prefix must match category (SEC/PII/QUA/INT)', () => {
	const r = scanSoulFiles(DIRTY, { expectedHashes: { 'SOUL.md': '0'.repeat(64) } });

	for (const issue of r.issues) {
		if (issue.rule.startsWith('SEC')) {
			assert.equal(issue.category, 'security', `SEC rule ${issue.rule} must be category=security`);
		}
		if (issue.rule.startsWith('PII')) {
			assert.equal(issue.category, 'pii', `PII rule ${issue.rule} must be category=pii`);
		}
		if (issue.rule.startsWith('QUA')) {
			assert.equal(issue.category, 'quality', `QUA rule ${issue.rule} must be category=quality`);
		}
		if (issue.rule.startsWith('INT')) {
			assert.equal(issue.category, 'integrity', `INT rule ${issue.rule} must be category=integrity`);
		}
	}
});

test('categories object always exposes all 4 layer counts (README "4-layer" contract)', () => {
	const r = scanSoulFiles(CLEAN);
	assert.equal(typeof r.categories.security, 'number');
	assert.equal(typeof r.categories.pii, 'number');
	assert.equal(typeof r.categories.quality, 'number');
	assert.equal(typeof r.categories.integrity, 'number');
});

test('grade bands align with WasmClaw 0.5.0 (A>=90, B>=75, C>=50, D>=25, F<25)', () => {
	const r = scanSoulFiles(DIRTY);

	const expectedGrade =
		r.score >= 90 ? 'A' :
		r.score >= 75 ? 'B' :
		r.score >= 50 ? 'C' :
		r.score >= 25 ? 'D' : 'F';
	assert.equal(r.grade, expectedGrade, `grade/score inconsistent: score=${r.score} grade=${r.grade}`);
});
