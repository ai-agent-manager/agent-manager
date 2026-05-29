import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Mock paths to redirect cache to a temp directory
const mockAgentmanDir = path.join(os.tmpdir(), `agentman-importer-test-${Date.now()}`);
vi.mock('../../../src/config/paths.js', () => ({
  getAgentmanDir: () => mockAgentmanDir,
  getBundlesDir: () => path.join(mockAgentmanDir, 'bundles'),
  getBundleVersionDir: (version: string) => path.join(mockAgentmanDir, 'bundles', version),
  getCurrentBundleLink: () => path.join(mockAgentmanDir, 'current'),
  getConfigPath: () => path.join(mockAgentmanDir, 'config.json'),
  getTempDir: () => path.join(mockAgentmanDir, 'tmp'),
}));

import { importLocalBundle, generateDevVersion } from '../../../src/bundle/importer.js';

describe('generateDevVersion', () => {
  it('generates dev-YYYYMMDDhhmm format', () => {
    const date = new Date(2026, 2, 18, 14, 30); // March 18, 2026 14:30
    expect(generateDevVersion(date)).toBe('dev-202603181430');
  });

  it('pads single-digit months, days, hours, minutes', () => {
    const date = new Date(2026, 0, 5, 3, 7); // Jan 5, 2026 03:07
    expect(generateDevVersion(date)).toBe('dev-202601050307');
  });
});

describe('importLocalBundle', () => {
  let sourceDir: string;

  // Uses real disk I/O (mkdir, writeFile, cp) — allow extra headroom on slow/loaded machines.
  vi.setConfig({ testTimeout: 15000 });

  beforeEach(async () => {
    sourceDir = path.join(os.tmpdir(), `import-source-${Date.now()}`);
    await mkdir(sourceDir, { recursive: true });
    await mkdir(path.join(mockAgentmanDir, 'bundles'), { recursive: true });
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(mockAgentmanDir, { recursive: true, force: true });
  });

  describe('with manifest.json', () => {
    const manifest = {
      version: 'abc1234def5678',
      published: '2026-03-10T14:30:00',
    };

    beforeEach(async () => {
      await writeFile(
        path.join(sourceDir, 'manifest.json'),
        JSON.stringify(manifest)
      );
      // Add a skill file
      const skillDir = path.join(sourceDir, 'test-skill');
      await mkdir(skillDir);
      await writeFile(path.join(skillDir, 'SKILL.md'), '# Test Skill');
    });

    it('copies bundle into cache using manifest version', async () => {
      const result = await importLocalBundle(sourceDir);

      expect(result.manifest.version).toBe('abc1234def5678');
      expect(result.manifest.published).toBe('2026-03-10T14:30:00');
      expect(result.isNew).toBe(true);
      expect(result.warning).toBeUndefined();

      // Verify files were copied
      const cachedManifest = JSON.parse(
        await readFile(path.join(result.bundleDir, 'manifest.json'), 'utf-8')
      );
      expect(cachedManifest.version).toBe('abc1234def5678');

      const skillContent = await readFile(
        path.join(result.bundleDir, 'test-skill', 'SKILL.md'),
        'utf-8'
      );
      expect(skillContent).toBe('# Test Skill');
    });

    it('returns isNew: false when version already cached', async () => {
      // First import
      await importLocalBundle(sourceDir);

      // Second import — same version, should be cached
      const result = await importLocalBundle(sourceDir);
      expect(result.isNew).toBe(false);
      expect(result.manifest.version).toBe('abc1234def5678');
    });

    it('preserves all files in the copy', async () => {
      // Add additional files
      await writeFile(path.join(sourceDir, 'README.md'), '# Readme');
      const rovoDir = path.join(sourceDir, 'test-rovo');
      await mkdir(rovoDir);
      await writeFile(path.join(rovoDir, 'rovo-agent.yaml'), 'name: test');

      const result = await importLocalBundle(sourceDir);

      const entries = await readdir(result.bundleDir, { recursive: true });
      expect(entries).toContain('manifest.json');
      expect(entries).toContain('README.md');
      expect(entries).toContain(path.join('test-skill', 'SKILL.md'));
      expect(entries).toContain(path.join('test-rovo', 'rovo-agent.yaml'));
    });
  });

  describe('without manifest.json', () => {
    beforeEach(async () => {
      // Just add a skill, no manifest
      const skillDir = path.join(sourceDir, 'test-skill');
      await mkdir(skillDir);
      await writeFile(path.join(skillDir, 'SKILL.md'), '# Test Skill');
    });

    it('generates a dev version and returns a warning', async () => {
      const result = await importLocalBundle(sourceDir);

      expect(result.manifest.version).toMatch(/^dev-\d{12}$/);
      expect(result.manifest.published).toBeTruthy();
      expect(result.isNew).toBe(true);
      expect(result.warning).toContain('No manifest.json found');
      expect(result.warning).toContain('dev version');
      expect(result.warning).toContain('not suitable for production');
    });

    it('writes generated manifest into cached copy', async () => {
      const result = await importLocalBundle(sourceDir);

      const cachedManifest = JSON.parse(
        await readFile(path.join(result.bundleDir, 'manifest.json'), 'utf-8')
      );
      expect(cachedManifest.version).toMatch(/^dev-\d{12}$/);
      expect(cachedManifest.published).toBeTruthy();
    });

    it('copies skill files alongside generated manifest', async () => {
      const result = await importLocalBundle(sourceDir);

      const skillContent = await readFile(
        path.join(result.bundleDir, 'test-skill', 'SKILL.md'),
        'utf-8'
      );
      expect(skillContent).toBe('# Test Skill');
    });
  });
});
