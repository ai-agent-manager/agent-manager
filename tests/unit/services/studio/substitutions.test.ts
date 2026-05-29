import { describe, it, expect } from 'vitest';
import {
  substituteKbFilenames,
  applyKbUrlSubstitutions,
} from '../../../../src/services/studio/substitutions.js';
import type { KnowledgePage } from '../../../../src/services/confluence/types.js';
import type { RovoAgentConfig } from '../../../../src/bundle/scanner.js';

const pages: KnowledgePage[] = [
  { title: '01_epic_breakdown_analysis', url: 'https://example.atlassian.net/wiki/pages/1' },
  { title: '02_acceptance_criteria', url: 'https://example.atlassian.net/wiki/pages/2' },
];

describe('substituteKbFilenames', () => {
  it('replaces .md filename references with Markdown links', () => {
    const text = 'See 01_epic_breakdown_analysis.md for details';
    const result = substituteKbFilenames(text, pages);
    expect(result).toBe(
      'See [01_epic_breakdown_analysis](https://example.atlassian.net/wiki/pages/1) for details'
    );
  });

  it('replaces multiple filename references in one string', () => {
    const text = '01_epic_breakdown_analysis.md and 02_acceptance_criteria.md';
    const result = substituteKbFilenames(text, pages);
    expect(result).toContain('[01_epic_breakdown_analysis](https://example.atlassian.net/wiki/pages/1)');
    expect(result).toContain('[02_acceptance_criteria](https://example.atlassian.net/wiki/pages/2)');
  });

  it('does not double-wrap existing Markdown links', () => {
    const text = '[01_epic_breakdown_analysis](existing-url)';
    const result = substituteKbFilenames(text, pages);
    // Should remain unchanged — the lookbehind/lookahead should prevent double-wrapping
    expect(result).toBe('[01_epic_breakdown_analysis](existing-url)');
  });

  it('returns original text when pages array is empty', () => {
    const text = 'See 01_epic_breakdown_analysis.md';
    const result = substituteKbFilenames(text, []);
    expect(result).toBe(text);
  });

  it('returns original text when no filenames match', () => {
    const text = 'No filenames here';
    const result = substituteKbFilenames(text, pages);
    expect(result).toBe(text);
  });
});

describe('applyKbUrlSubstitutions', () => {
  const baseConfig: RovoAgentConfig = {
    apiVersion: 'rovo.atlassian.com/v1',
    kind: 'StudioAgent',
    identity: {
      name: 'Test Agent',
      description: 'A test agent',
      behavior: 'Refer to 01_epic_breakdown_analysis.md for guidance',
    },
    scenarios: {
      default: {
        instructions: 'Use 01_epic_breakdown_analysis.md and 02_acceptance_criteria.md',
      },
      custom: [
        {
          name: 'Custom 1',
          instructions: 'Check 01_epic_breakdown_analysis.md',
          trigger: 'test',
        },
      ],
    },
  };

  it('replaces filenames in identity.behavior', () => {
    const result = applyKbUrlSubstitutions(baseConfig, pages);
    expect(result.identity.behavior).toContain('[01_epic_breakdown_analysis]');
    expect(result.identity.behavior).not.toContain('.md');
  });

  it('replaces filenames in scenarios.default.instructions', () => {
    const result = applyKbUrlSubstitutions(baseConfig, pages);
    expect(result.scenarios.default.instructions).toContain('[01_epic_breakdown_analysis]');
    expect(result.scenarios.default.instructions).toContain('[02_acceptance_criteria]');
  });

  it('replaces filenames in scenarios.custom[*].instructions', () => {
    const result = applyKbUrlSubstitutions(baseConfig, pages);
    expect(result.scenarios.custom![0].instructions).toContain('[01_epic_breakdown_analysis]');
  });

  it('returns config unchanged when pages array is empty', () => {
    const result = applyKbUrlSubstitutions(baseConfig, []);
    expect(result).toBe(baseConfig); // Same reference — no copy needed
  });

  it('does not mutate the original config', () => {
    const originalBehavior = baseConfig.identity.behavior;
    applyKbUrlSubstitutions(baseConfig, pages);
    expect(baseConfig.identity.behavior).toBe(originalBehavior);
  });
});
