/**
 * Persona Drift Detection — monitors if agent responses
 * stay consistent with the soul's defined persona.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DriftResult {
	drifted: boolean;
	score: number;  // 0-100, higher = more aligned
	signals: string[];
}

interface PersonaProfile {
	identity: string[];    // key identity terms
	style: string[];       // expected style markers
	boundaries: string[];  // things the persona should NOT do
}

/** Extract persona profile from SOUL.md content */
export function extractPersonaProfile(soulContent: string): PersonaProfile {
	const identity: string[] = [];
	const style: string[] = [];
	const boundaries: string[] = [];

	const lines = soulContent.split('\n');
	let section = '';

	for (const line of lines) {
		const lower = line.toLowerCase().trim();
		if (lower.startsWith('## ') || lower.startsWith('# ')) {
			if (lower.includes('persona') || lower.includes('identity') || lower.includes('personality')) section = 'identity';
			else if (lower.includes('style') || lower.includes('communication') || lower.includes('tone')) section = 'style';
			else if (lower.includes('boundar') || lower.includes('limitation') || lower.includes('constraint')) section = 'boundaries';
			else section = '';
			continue;
		}

		if (line.trim().startsWith('-') || line.trim().startsWith('*')) {
			const text = line.replace(/^[\s*-]+/, '').trim();
			if (!text) continue;
			if (section === 'identity') identity.push(text);
			else if (section === 'style') style.push(text);
			else if (section === 'boundaries') boundaries.push(text);
		}
	}

	return { identity, style, boundaries };
}

/** Check if a response drifts from the persona */
export function detectDrift(response: string, profile: PersonaProfile): DriftResult {
	const signals: string[] = [];
	let alignmentScore = 100;

	// Check for boundary violations
	for (const boundary of profile.boundaries) {
		const keywords = boundary.toLowerCase().split(/\s+/).filter(w => w.length > 3);
		const matches = keywords.filter(kw => response.toLowerCase().includes(kw));
		if (matches.length >= keywords.length * 0.5) {
			signals.push(`Possible boundary violation: "${boundary}"`);
			alignmentScore -= 15;
		}
	}

	// Check tone consistency — very basic heuristic
	const hasExcessiveEmoji = (response.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu) || []).length > 5;
	if (hasExcessiveEmoji) {
		const styleText = profile.style.join(' ').toLowerCase();
		if (styleText.includes('formal') || styleText.includes('professional') || styleText.includes('concise')) {
			signals.push('Excessive emoji usage inconsistent with formal style');
			alignmentScore -= 10;
		}
	}

	// Check response length vs style expectations
	if (response.length > 5000) {
		const styleText = profile.style.join(' ').toLowerCase();
		if (styleText.includes('concise') || styleText.includes('brief') || styleText.includes('short')) {
			signals.push('Response length inconsistent with concise style');
			alignmentScore -= 5;
		}
	}

	return {
		drifted: alignmentScore < 70,
		score: Math.max(0, alignmentScore),
		signals,
	};
}

/** Load persona profile from workspace */
export function loadPersonaProfile(workspaceDir: string): PersonaProfile | null {
	const soulPath = path.join(workspaceDir, 'SOUL.md');
	try {
		const content = fs.readFileSync(soulPath, 'utf-8');
		return extractPersonaProfile(content);
	} catch {
		return null;
	}
}
