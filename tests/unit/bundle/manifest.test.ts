import { describe, it, expect } from 'vitest';
import { parseManifest } from '../../../src/bundle/manifest.js';

describe('parseManifest', () => {
  it('parses a valid manifest without agents', () => {
    const raw = JSON.stringify({ version: 'abc123', published: '2026-03-10T14:30:00' });
    const result = parseManifest(raw);
    expect(result.version).toBe('abc123');
    expect(result.published).toBe('2026-03-10T14:30:00');
    expect(result.agents).toBeUndefined();
  });

  it('parses a valid manifest with agents metadata', () => {
    const raw = JSON.stringify({
      version: 'abc123',
      published: '2026-03-10T14:30:00',
      agents: [
        { id: 'my-skill', name: 'My Skill', description: 'A skill', tags: ['agent-skill'] },
        { id: 'my-agent', name: 'My Agent', description: 'An agent' },
      ],
    });
    const result = parseManifest(raw);
    expect(result.agents).toHaveLength(2);
    expect(result.agents![0].id).toBe('my-skill');
    expect(result.agents![0].name).toBe('My Skill');
    expect(result.agents![0].tags).toEqual(['agent-skill']);
    expect(result.agents![1].id).toBe('my-agent');
    expect(result.agents![1].tags).toBeUndefined();
  });

  it('parses phases from agent entries', () => {
    const raw = JSON.stringify({
      version: 'abc123',
      published: '2026-03-10T14:30:00',
      agents: [
        { id: 'my-skill', name: 'My Skill', description: 'A skill', phases: ['design', 'build'] },
        { id: 'legacy-skill', name: 'Legacy Skill', description: 'No phases' },
      ],
    });
    const result = parseManifest(raw);
    expect(result.agents![0].phases).toEqual(['design', 'build']);
    // Legacy entries without phases parse cleanly — field is absent
    expect(result.agents![1].phases).toBeUndefined();
  });

  it('throws on missing version', () => {
    expect(() => parseManifest(JSON.stringify({ published: '2026-01-01' }))).toThrow('version');
  });

  it('throws on missing published', () => {
    expect(() => parseManifest(JSON.stringify({ version: 'abc' }))).toThrow('published');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseManifest('not json')).toThrow();
  });
});
