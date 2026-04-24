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
	assert.ok(r.score >= 90, `expected A-band (>=90), got ${r.score}`);
	assert.equal(r.grade, 'A', `expected grade A, got ${r.grade}`);
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

test('multi-layer separation: no SEC-category rule bleeds into PII, and vice versa', () => {
	const r = scanSoulFiles(DIRTY);

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
	}
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
