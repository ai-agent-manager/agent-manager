import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installResolvedAgents } from '../../../src/operations/install.js';
import type { AgentInfo } from '../../../src/bundle/scanner.js';

describe('installResolvedAgents', () => {
  let tempDir: string;
  let agentsDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `install-agents-test-${Date.now()}`);
    agentsDir = join(tempDir, 'agents');
    skillsDir = join(tempDir, 'skills');
    await mkdir(agentsDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('dependency handling', () => {
    it('should install agent successfully if skill already installed', async () => {
      // Create an installed skill
      const skillPath = join(skillsDir, 'existing-skill');
      await mkdir(skillPath);
      await writeFile(join(skillPath, 'SKILL.md'), '---\nname: Existing Skill\n---\nContent');

      // Create agent with dependency on existing skill
      const agentPath = join(agentsDir, 'test-agent');
      await mkdir(agentPath);
      await writeFile(
        join(agentPath, 'AGENT.md'),
        `---
name: Test Agent
description: Test
dependencies:
  bundle: self
  skills:
    - existing-skill
---
# Test Agent
`,
      );

      const agent: AgentInfo = {
        dirName: 'test-agent',
        dirPath: agentPath,
        agentMdPath: join(agentPath, 'AGENT.md'),
        tools: ['claude-code'],
        meta: null,
        dependencies: {
          bundle: 'self',
          skills: ['existing-skill'],
        },
      };

      // Mock minimal required options
      const result = await installResolvedAgents({
        agents: [agent],
        toolId: 'claude-code',
        scope: 'system',
        bundleVersion: '1.0.0',
        bundleUrl: undefined,
      });

      // Should succeed (skill already installed)
      expect(result.errors).toHaveLength(0);
      expect(result.installed.length).toBeGreaterThan(0);
    });

    it('should fail with error if skill missing and no bundle URL', async () => {
      // Create agent with dependency on non-existent skill
      const agentPath = join(agentsDir, 'test-agent');
      await mkdir(agentPath);
      await writeFile(
        join(agentPath, 'AGENT.md'),
        `---
name: Test Agent
description: Test
dependencies:
  bundle: self
  skills:
    - missing-skill
---
# Test Agent
`,
      );

      const agent: AgentInfo = {
        dirName: 'test-agent',
        dirPath: agentPath,
        agentMdPath: join(agentPath, 'AGENT.md'),
        tools: ['claude-code'],
        meta: null,
        dependencies: {
          bundle: 'self',
          skills: ['missing-skill'],
        },
      };

      const result = await installResolvedAgents({
        agents: [agent],
        toolId: 'claude-code',
        scope: 'system',
        bundleVersion: '1.0.0',
        bundleUrl: undefined, // No bundle URL
      });

      // Should fail with error about missing skill
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toContain('not found');
      expect(result.installed).toHaveLength(0);
    });

    it('should not install agent if partial skill installation fails', async () => {
      // Create agent with multiple dependencies
      const agentPath = join(agentsDir, 'test-agent');
      await mkdir(agentPath);
      await writeFile(
        join(agentPath, 'AGENT.md'),
        `---
name: Test Agent
description: Test
dependencies:
  bundle: self
  skills:
    - skill-one
    - skill-two
---
# Test Agent
`,
      );

      const agent: AgentInfo = {
        dirName: 'test-agent',
        dirPath: agentPath,
        agentMdPath: join(agentPath, 'AGENT.md'),
        tools: ['claude-code'],
        meta: null,
        dependencies: {
          bundle: 'self',
          skills: ['skill-one', 'skill-two'],
        },
      };

      const result = await installResolvedAgents({
        agents: [agent],
        toolId: 'claude-code',
        scope: 'system',
        bundleVersion: '1.0.0',
        bundleUrl: undefined,
      });

      // Should fail - skills not available
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.installed).toHaveLength(0);
    });

    it('should report error if bundle URL is invalid', async () => {
      const agentPath = join(agentsDir, 'test-agent');
      await mkdir(agentPath);
      await writeFile(
        join(agentPath, 'AGENT.md'),
        `---
name: Test Agent
description: Test
dependencies:
  bundle: https://invalid-bundle-url.example.com
  skills:
    - some-skill
---
# Test Agent
`,
      );

      const agent: AgentInfo = {
        dirName: 'test-agent',
        dirPath: agentPath,
        agentMdPath: join(agentPath, 'AGENT.md'),
        tools: ['claude-code'],
        meta: null,
        dependencies: {
          bundle: 'https://invalid-bundle-url.example.com',
          skills: ['some-skill'],
        },
      };

      const result = await installResolvedAgents({
        agents: [agent],
        toolId: 'claude-code',
        scope: 'system',
        bundleVersion: '1.0.0',
        bundleUrl: undefined,
      });

      // Should fail with network/resolve error
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.installed).toHaveLength(0);
    });
  });
});
