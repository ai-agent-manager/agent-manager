import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { scanBundle, parseRovoAgentYaml, RovoAgentValidationError, lastParseWarnings } from '../../../src/bundle/scanner.js';
import type { AgentManifestEntry } from '../../../src/bundle/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/valid-bundle');

describe('scanBundle', () => {
  it('discovers skills with SKILL.md (README fallback)', async () => {
    const result = await scanBundle(FIXTURES_DIR);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].dirName).toBe('test-skill');
    expect(result.skills[0].meta?.name).toBe('Test Skill');
    expect(result.skills[0].meta?.tags).toContain('agent-skill');
  });

  it('discovers Rovo agents with rovo-agent.yaml (README fallback)', async () => {
    const result = await scanBundle(FIXTURES_DIR);
    expect(result.rovoAgents).toHaveLength(1);
    expect(result.rovoAgents[0].dirName).toBe('test-rovo-agent');
    expect(result.rovoAgents[0].config.identity.name).toBe('Test Agent');
    expect(result.rovoAgents[0].config.identity.description).toBe('A test Rovo agent');
    expect(result.rovoAgents[0].config.identity.behavior).toBe('Helpful and concise');
    expect(result.rovoAgents[0].config.apiVersion).toBe('rovo.atlassian.com/v1');
    expect(result.rovoAgents[0].config.kind).toBe('StudioAgent');
    expect(result.rovoAgents[0].meta?.tags).toContain('rovo-agent');
  });

  it('uses manifest metadata when provided', async () => {
    const manifestAgents: AgentManifestEntry[] = [
      { id: 'test-skill', name: 'Manifest Skill Name', description: 'From manifest', tags: ['agent-skill', 'manifest-tag'] },
      { id: 'test-rovo-agent', name: 'Manifest Agent Name', description: 'From manifest', tags: ['rovo-agent', 'manifest-tag'] },
    ];
    const result = await scanBundle(FIXTURES_DIR, manifestAgents);

    // Metadata should come from manifest, not README
    expect(result.skills[0].meta?.name).toBe('Manifest Skill Name');
    expect(result.skills[0].meta?.description).toBe('From manifest');
    expect(result.skills[0].meta?.tags).toContain('manifest-tag');

    expect(result.rovoAgents[0].meta?.name).toBe('Manifest Agent Name');
    expect(result.rovoAgents[0].meta?.tags).toContain('manifest-tag');
  });

  it('falls back to README when agent is not in manifest', async () => {
    // Provide manifest with only one agent — the other should fall back to README
    const manifestAgents: AgentManifestEntry[] = [
      { id: 'test-skill', name: 'Manifest Skill', description: 'From manifest', tags: ['agent-skill'] },
    ];
    const result = await scanBundle(FIXTURES_DIR, manifestAgents);

    // test-skill: from manifest
    expect(result.skills[0].meta?.name).toBe('Manifest Skill');

    // test-rovo-agent: falls back to README
    expect(result.rovoAgents[0].meta?.name).toBe('Test Agent');
    expect(result.rovoAgents[0].meta?.description).toBe('A test Rovo agent for unit tests');
  });

  it('parses default scenario from rovo-agent.yaml', async () => {
    const result = await scanBundle(FIXTURES_DIR);
    const defaultScenario = result.rovoAgents[0].config.scenarios.default;
    expect(defaultScenario.instructions).toBe('You are a test agent.');
    expect(defaultScenario.knowledge).toBe('all');
    expect(defaultScenario.webSearch).toBe(false);
    expect(defaultScenario.skills).toEqual(['Create page']);
  });

  it('parses custom scenarios from rovo-agent.yaml', async () => {
    const result = await scanBundle(FIXTURES_DIR);
    const custom = result.rovoAgents[0].config.scenarios.custom;
    expect(custom).toHaveLength(1);
    expect(custom![0].name).toBe('Greeting');
    expect(custom![0].trigger).toBe('When someone says hello or greets the agent');
    expect(custom![0].instructions).toBe('Respond with a friendly greeting.');
    expect(custom![0].knowledge).toBe('none');
    expect(custom![0].deepResearch).toBe(false);
  });

  it('parses conversation starters from rovo-agent.yaml', async () => {
    const result = await scanBundle(FIXTURES_DIR);
    const starters = result.rovoAgents[0].config.identity.conversationStarters;
    expect(starters).toEqual(['Help me get started']);
  });

  it('returns empty arrays for empty directory', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'agentman-test-'));
    const result = await scanBundle(emptyDir);
    expect(result.skills).toHaveLength(0);
    expect(result.rovoAgents).toHaveLength(0);
  });
});

describe('parseRovoAgentYaml', () => {
  it('parses valid YAML and returns typed config', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: "Be concise"
scenarios:
  default:
    instructions: "Help users."
`;
    const config = await parseRovoAgentYaml(yaml);
    expect(config.apiVersion).toBe('rovo.atlassian.com/v1');
    expect(config.kind).toBe('StudioAgent');
    expect(config.identity.name).toBe('My Agent');
    expect(config.scenarios.default.instructions).toBe('Help users.');
  });

  it('throws RovoAgentValidationError for missing required fields', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "My Agent"
`;
    await expect(parseRovoAgentYaml(yaml)).rejects.toThrow(RovoAgentValidationError);
  });

  it('throws RovoAgentValidationError for wrong apiVersion', async () => {
    const yaml = `
apiVersion: wrong/v1
kind: StudioAgent
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: "Be concise"
scenarios:
  default:
    instructions: "Help users."
`;
    await expect(parseRovoAgentYaml(yaml)).rejects.toThrow(RovoAgentValidationError);
  });

  it('throws RovoAgentValidationError for wrong kind', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: WrongKind
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: "Be concise"
scenarios:
  default:
    instructions: "Help users."
`;
    await expect(parseRovoAgentYaml(yaml)).rejects.toThrow(RovoAgentValidationError);
  });

  it('throws RovoAgentValidationError for invalid knowledge value', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: "Be concise"
scenarios:
  default:
    instructions: "Help users."
    knowledge: "invalid"
`;
    await expect(parseRovoAgentYaml(yaml)).rejects.toThrow(RovoAgentValidationError);
  });

  it('throws RovoAgentValidationError for custom scenario without trigger', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: "Be concise"
scenarios:
  default:
    instructions: "Help users."
  custom:
    - name: "No Trigger Scenario"
      instructions: "Do something."
`;
    await expect(parseRovoAgentYaml(yaml)).rejects.toThrow(RovoAgentValidationError);
  });

  it('truncates conversation starters to 3 and emits warning', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: "Be concise"
  conversationStarters:
    - "Starter 1"
    - "Starter 2"
    - "Starter 3"
    - "Starter 4"
scenarios:
  default:
    instructions: "Help users."
`;
    const config = await parseRovoAgentYaml(yaml);
    expect(config.identity.conversationStarters).toEqual(['Starter 1', 'Starter 2', 'Starter 3']);
    expect(lastParseWarnings.length).toBe(1);
    expect(lastParseWarnings[0]).toContain('truncated');
  });

  it('accepts optional knowledgeSources', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: "Be concise"
scenarios:
  default:
    instructions: "Help users."
    knowledge: custom
knowledgeSources:
  - type: confluence
    filter: "all"
  - type: jira
    filter: "PROJ"
`;
    const config = await parseRovoAgentYaml(yaml);
    expect(config.knowledgeSources).toHaveLength(2);
    expect(config.knowledgeSources![0].type).toBe('confluence');
    expect(config.knowledgeSources![1].filter).toBe('PROJ');
  });

  it('includes error details in validation error', async () => {
    const yaml = `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
`;
    try {
      await parseRovoAgentYaml(yaml);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RovoAgentValidationError);
      const validationError = err as RovoAgentValidationError;
      expect(validationError.errors.length).toBeGreaterThan(0);
      expect(validationError.message).toContain('Invalid rovo-agent.yaml');
    }
  });
});

// ---------------------------------------------------------------------------
// $file resolution tests
// ---------------------------------------------------------------------------

/** Helper: create a temp directory with the given files and return its path. */
async function createTempAgent(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agentman-fileref-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
  return dir;
}

/** Minimal valid YAML template. Callers override specific fields. */
function minimalYaml(overrides: {
  behavior?: string;
  defaultInstructions?: string;
  customScenarios?: string;
} = {}): string {
  const behavior = overrides.behavior ?? '"Be concise"';
  const instructions = overrides.defaultInstructions ?? '"Help users."';
  const custom = overrides.customScenarios
    ? `\n  custom:\n${overrides.customScenarios}`
    : '';
  return `
apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "My Agent"
  description: "A helpful agent"
  behavior: ${behavior}
scenarios:
  default:
    instructions: ${instructions}${custom}
`;
}

describe('$file resolution', () => {
  it('resolves $file reference for default scenario instructions', async () => {
    const dir = await createTempAgent({
      'instructions.md': 'You are a helpful agent from a file.',
    });
    const yaml = minimalYaml({
      defaultInstructions: '\n      $file: ./instructions.md',
    });
    const config = await parseRovoAgentYaml(yaml, dir);
    expect(config.scenarios.default.instructions).toBe(
      'You are a helpful agent from a file.',
    );
  });

  it('resolves $file reference for identity.behavior', async () => {
    const dir = await createTempAgent({
      'behavior.md': 'Tone: professional and direct.',
    });
    const yaml = minimalYaml({
      behavior: '\n    $file: ./behavior.md',
    });
    const config = await parseRovoAgentYaml(yaml, dir);
    expect(config.identity.behavior).toBe('Tone: professional and direct.');
  });

  it('resolves $file reference for custom scenario instructions', async () => {
    const dir = await createTempAgent({
      'scenarios/greeting.md': 'Greet the user warmly.',
    });
    const yaml = minimalYaml({
      customScenarios: `    - name: "Greeting"
      trigger: "When someone says hello"
      instructions:
        $file: ./scenarios/greeting.md`,
    });
    const config = await parseRovoAgentYaml(yaml, dir);
    expect(config.scenarios.custom).toHaveLength(1);
    expect(config.scenarios.custom![0].instructions).toBe(
      'Greet the user warmly.',
    );
  });

  it('supports mix of inline and $file in the same config', async () => {
    const dir = await createTempAgent({
      'scenarios/custom.md': 'Custom instructions from file.',
    });
    const yaml = minimalYaml({
      // behavior is inline, default instructions is inline
      customScenarios: `    - name: "From File"
      trigger: "When triggered"
      instructions:
        $file: ./scenarios/custom.md
    - name: "Inline"
      trigger: "When asked"
      instructions: "Inline instructions."`,
    });
    const config = await parseRovoAgentYaml(yaml, dir);
    expect(config.identity.behavior).toBe('Be concise');
    expect(config.scenarios.default.instructions).toBe('Help users.');
    expect(config.scenarios.custom![0].instructions).toBe(
      'Custom instructions from file.',
    );
    expect(config.scenarios.custom![1].instructions).toBe(
      'Inline instructions.',
    );
  });

  it('resolves $file in a nested subdirectory', async () => {
    const dir = await createTempAgent({
      'scenarios/default/instructions.md': 'Deeply nested content.',
    });
    const yaml = minimalYaml({
      defaultInstructions: '\n      $file: ./scenarios/default/instructions.md',
    });
    const config = await parseRovoAgentYaml(yaml, dir);
    expect(config.scenarios.default.instructions).toBe(
      'Deeply nested content.',
    );
  });

  it('preserves multi-line file content verbatim', async () => {
    const content = 'Line 1\nLine 2\n\nLine 4 after blank\n';
    const dir = await createTempAgent({
      'instructions.md': content,
    });
    const yaml = minimalYaml({
      defaultInstructions: '\n      $file: ./instructions.md',
    });
    const config = await parseRovoAgentYaml(yaml, dir);
    expect(config.scenarios.default.instructions).toBe(content);
  });

  it('throws for missing $file target', async () => {
    const dir = await createTempAgent({});
    const yaml = minimalYaml({
      defaultInstructions: '\n      $file: ./does-not-exist.md',
    });
    await expect(parseRovoAgentYaml(yaml, dir)).rejects.toThrow(
      RovoAgentValidationError,
    );
    await expect(parseRovoAgentYaml(yaml, dir)).rejects.toThrow(
      /failed to read \$file/,
    );
  });

  it('throws for absolute $file path', async () => {
    const dir = await createTempAgent({});
    const yaml = minimalYaml({
      defaultInstructions: '\n      $file: /etc/passwd',
    });
    // The schema regex rejects absolute paths, so this should fail validation
    await expect(parseRovoAgentYaml(yaml, dir)).rejects.toThrow(
      RovoAgentValidationError,
    );
  });

  it('throws for $file path containing ".."', async () => {
    const dir = await createTempAgent({});
    const yaml = minimalYaml({
      defaultInstructions: '\n      $file: ../escape.md',
    });
    // The schema regex rejects '..' segments
    await expect(parseRovoAgentYaml(yaml, dir)).rejects.toThrow(
      RovoAgentValidationError,
    );
  });

  it('throws for empty $file path', async () => {
    const dir = await createTempAgent({});
    const yaml = minimalYaml({
      defaultInstructions: '\n      $file: ""',
    });
    await expect(parseRovoAgentYaml(yaml, dir)).rejects.toThrow(
      RovoAgentValidationError,
    );
  });

  it('inline strings still work (backwards compatibility)', async () => {
    const config = await parseRovoAgentYaml(minimalYaml());
    expect(config.identity.behavior).toBe('Be concise');
    expect(config.scenarios.default.instructions).toBe('Help users.');
  });
});
