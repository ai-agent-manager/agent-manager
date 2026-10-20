import { describe, expect, it } from 'vitest';
import { buildSessionCatalogue, effectiveBundleVersion, toCatalogueSkills } from '../../../src/operations/catalogue.js';
import type { Session } from '../../../src/operations/session.js';

function session(overrides: Partial<Session> = {}): Session {
  return {
    source: { type: 'url', baseUrl: 'https://skills.example.com/agents' },
    manifest: { version: '1.0.0', published: '2026-01-01' },
    bundleContents: { skills: [{ dirName: 'skill', dirPath: '/example/skill', skillMdPath: '/example/skill/SKILL.md' }], rovoAgents: [] },
    auth: { required: false, authenticated: false }, membership: { state: 'not-required', projects: [] },
    catalogueScope: { kind: 'unrestricted' }, warnings: [], ...overrides,
  };
}

describe('session catalogue conversion', () => {
  it('preserves the HTTP content root and version in legacy pins without mutating scanned skills', () => {
    const state = session();
    const [skill] = toCatalogueSkills(state);
    expect(skill.sourcePin).toMatchObject({
      sourceType: 'bundle', bundleBaseUrl: 'https://skills.example.com/agents', bundleVersion: '1.0.0', bundleAddressing: 'content-root',
    });
    expect(state.bundleContents?.skills[0].sourcePin).toBeUndefined();
  });

  it('does not overwrite discovery pins with a global bundle version', () => {
    const pin = { sourceType: 'repo' as const, repoUrl: 'https://github.com/example/skills', ref: 'release' };
    const skills = [{ dirName: 'skill', dirPath: '/example/skill', skillMdPath: '/example/skill/SKILL.md', sourceName: 'git', sourceType: 'git' as const, sourcePin: pin }];
    const state = session({ discoverySkills: skills });
    expect(toCatalogueSkills(state)).toBe(skills);
    const entry = buildSessionCatalogue(state)[0];
    expect(entry.kind === 'skill' && entry.candidates[0].skill.sourcePin).toEqual(pin);
  });

  it('uses discovery or unknown version labels when no legacy manifest exists', () => {
    expect(effectiveBundleVersion(session({ manifest: undefined, discoveryBundleVersion: '2.0.0' }))).toBe('2.0.0');
    expect(effectiveBundleVersion(session({ manifest: undefined }))).toBe('unknown');
    expect(effectiveBundleVersion(session({ discoveryBundleVersion: '2.0.0' }))).toBe('1.0.0');
  });
});
