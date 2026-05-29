import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../../src/lib/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = `---
name: my-skill
description: A cool skill
tags:
  - agent-skill
---

# My Skill

Some content here.`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.meta.name).toBe('my-skill');
    expect(result!.meta.description).toBe('A cool skill');
    expect(result!.meta.tags).toEqual(['agent-skill']);
    expect(result!.body).toBe('# My Skill\n\nSome content here.');
  });

  it('returns null for no frontmatter', () => {
    const result = parseFrontmatter('# Just markdown');
    expect(result).toBeNull();
  });

  it('returns null for missing name', () => {
    const content = `---
description: No name here
---
Content`;
    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('handles description with colons (common YAML issue)', () => {
    const content = `---
name: test
description: "Use this when: working with files"
---
Body`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.meta.description).toBe('Use this when: working with files');
  });
});
