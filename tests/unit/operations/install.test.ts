import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installResolvedAgents } from '../../../src/operations/install.js';
import type { AgentInfo } from '../../../src/bundle/scanner.js';
import { pathExists } from '../../../src/lib/fs.js';

describe('installResolvedAgents', () => {
  let tempDir: string;
  let agentsDir: string;
  let skillsDir: string;
  let originalHome: { HOME?: string; USERPROFILE?: string };

  beforeEach(async () => {
    tempDir = join(tmpdir(), `install-agents-test-${Date.now()}`);
    agentsDir = join(tempDir, 'agents');
    skillsDir = join(tempDir, 'home', '.claude', 'skills');
    originalHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = join(tempDir, 'home');
    process.env.USERPROFILE = join(tempDir, 'home');
    await mkdir(agentsDir, { recursive: true });
    await mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome.HOME;
    process.env.USERPROFILE = originalHome.USERPROFILE;
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
  describe('broken dependencies and existing skills', () => {
    async function sourceSkill(name: string): Promise<void> {
      await mkdir(join(agentsDir, name), { recursive: true });
      await writeFile(join(agentsDir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: bundled\n---\nbundled\n`);
    }

    async function personalSkill(name: string): Promise<void> {
      await mkdir(join(skillsDir, name), { recursive: true });
      await writeFile(join(skillsDir, name, 'SKILL.md'), 'PERSONAL');
    }

    async function orchestrator(name: string, skills: string[]): Promise<AgentInfo> {
      const dirPath = join(agentsDir, name);
      await mkdir(join(dirPath, 'claude-code'), { recursive: true });
      await writeFile(join(dirPath, 'AGENT.md'), `---\nname: ${name}\ndescription: d\n---\nbody\n`);
      await writeFile(join(dirPath, 'claude-code', 'AGENT.md'), `---\nname: ${name}\n---\n`);
      return {
        dirName: name,
        dirPath,
        agentMdPath: join(dirPath, 'AGENT.md'),
        tools: ['claude-code'],
        meta: null,
        dependencies: { bundle: 'self', skills },
      };
    }

    const install = (agents: AgentInfo[], existingSkills?: 'keep' | 'backup' | 'abort') =>
      installResolvedAgents({ agents, toolId: 'claude-code', scope: 'system', existingSkills });

    const agentsInstallDir = () => join(tempDir, 'home', '.claude', 'agents');

    it('installs nothing when one dependency is misspelled, and suggests the likely name', async () => {
      await sourceSkill('skill-a');
      await sourceSkill('skill-b');
      const agent = await orchestrator('orch', ['skill-a', 'skill-b', 'skil-c']);
      await sourceSkill('skill-c');

      const result = await install([agent]);

      expect(result.installed).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('not found');
      expect(result.errors[0].error).toContain('skil-c (did you mean "skill-c"?)');
      expect(await readdir(skillsDir)).toEqual([]);
      expect(await pathExists(join(agentsInstallDir(), 'orch'))).toBe(false);
    });

    it('suggests the correctly-cased name for a case mismatch', async () => {
      await sourceSkill('idea-forge');
      const agent = await orchestrator('orch', ['Idea-Forge']);

      const result = await install([agent]);

      expect(result.errors[0].error).toContain('did you mean "idea-forge"?');
      expect(await readdir(skillsDir)).toEqual([]);
    });

    it('does not let a personal skill satisfy a mis-cased dependency', async () => {
      await sourceSkill('idea-forge');
      await mkdir(join(skillsDir, 'idea-forge'), { recursive: true });
      await writeFile(join(skillsDir, 'idea-forge', 'SKILL.md'), '---\nname: idea-forge\n---\nPERSONAL');
      const agent = await orchestrator('orch', ['Idea-Forge']);

      const result = await install([agent]);

      expect(result.installed).toHaveLength(0);
      expect(result.errors[0].error).toContain('Idea-Forge (did you mean "idea-forge"?)');
    });

    it('rejects dependency names that would escape the skills directory', async () => {
      const agent = await orchestrator('orch', ['../outside']);

      const result = await install([agent]);

      expect(result.errors[0].error).toContain('Invalid dependency skill name');
      expect(result.installed).toHaveLength(0);
    });

    it('still installs other agents when one has a broken dependency', async () => {
      await sourceSkill('skill-a');
      const broken = await orchestrator('broken', ['missing']);
      const good = await orchestrator('good', ['skill-a']);

      const result = await install([broken, good]);

      expect(result.errors.map((e) => e.name)).toEqual(['broken']);
      expect(result.installed.map((i) => i.name)).toEqual(['skill-a', 'good']);
    });

    it('keeps an unmanaged same-named skill by default and warns', async () => {
      await sourceSkill('skill-a');
      await personalSkill('skill-a');
      const agent = await orchestrator('orch', ['skill-a']);

      const result = await install([agent]);

      expect(result.errors).toHaveLength(0);
      expect(result.installed.map((i) => i.name)).toEqual(['orch']);
      expect(result.warnings?.[0]).toContain('Using existing "skill-a"');
      expect(await readFile(join(skillsDir, 'skill-a', 'SKILL.md'), 'utf8')).toBe('PERSONAL');
    });

    it('backs up and replaces an unmanaged same-named skill under the backup policy', async () => {
      await sourceSkill('skill-a');
      await personalSkill('skill-a');
      const agent = await orchestrator('orch', ['skill-a']);

      const result = await install([agent], 'backup');

      expect(result.errors).toHaveLength(0);
      expect(result.installed.map((i) => i.name)).toEqual(['skill-a', 'orch']);
      expect(await readFile(join(skillsDir, 'skill-a', 'SKILL.md'), 'utf8')).toContain('bundled');

      const backupsDir = join(tempDir, 'home', '.agentman', 'backups', 'claude-code');
      const [backup] = await readdir(backupsDir);
      expect(backup).toMatch(/^skill-a-/);
      expect(await readFile(join(backupsDir, backup, 'SKILL.md'), 'utf8')).toBe('PERSONAL');
      expect(result.warnings?.[0]).toContain('Backed up existing "skill-a"');
    });

    it('treats a differently named folder declaring the same skill name as the existing skill', async () => {
      await sourceSkill('skill-a');
      await mkdir(join(skillsDir, 'my-skill-a'), { recursive: true });
      await writeFile(join(skillsDir, 'my-skill-a', 'SKILL.md'), '---\nname: skill-a\n---\nPERSONAL');
      const agent = await orchestrator('orch', ['skill-a']);

      const kept = await install([agent]);

      expect(kept.installed.map((i) => i.name)).toEqual(['orch']);
      expect(kept.warnings?.[0]).toContain('Using existing "skill-a (in my-skill-a/)"');
      expect(await readdir(skillsDir)).toEqual(['my-skill-a']);

      const replaced = await install([agent], 'backup');

      expect(replaced.errors).toHaveLength(0);
      expect(replaced.warnings?.[0]).toContain('Backed up existing "my-skill-a"');
      expect(await readdir(skillsDir)).toEqual(['skill-a']);
    });

    it('refuses to install the agent under the abort policy', async () => {
      await sourceSkill('skill-a');
      await personalSkill('skill-a');
      const agent = await orchestrator('orch', ['skill-a']);

      const result = await install([agent], 'abort');

      expect(result.installed).toHaveLength(0);
      expect(result.errors[0].error).toContain('not installed by agentman: skill-a');
      expect(await readFile(join(skillsDir, 'skill-a', 'SKILL.md'), 'utf8')).toBe('PERSONAL');
    });
  });
});
