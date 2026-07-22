import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const mockAgentmanDir = path.join(os.tmpdir(), `agentman-extractor-test-${Date.now()}`);
vi.mock('../../../src/config/paths.js', () => ({
  getAgentmanDir: () => mockAgentmanDir,
  getBundlesDir: () => path.join(mockAgentmanDir, 'bundles'),
  getBundleVersionDir: (version: string) => path.join(mockAgentmanDir, 'bundles', version),
  getCurrentBundleLink: () => path.join(mockAgentmanDir, 'current'),
  getConfigPath: () => path.join(mockAgentmanDir, 'config.json'),
  getTempDir: () => path.join(mockAgentmanDir, 'tmp'),
}));

import { extractBundle, BUNDLE_META_FILE } from '../../../src/bundle/extractor.js';

async function buildZip(sourceDir: string, zipPath: string): Promise<void> {
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: sourceDir });
}

describe('extractBundle', () => {
  let workDir: string;

  vi.setConfig({ testTimeout: 15000 });

  beforeEach(async () => {
    workDir = path.join(os.tmpdir(), `extractor-work-${Date.now()}`);
    await mkdir(workDir, { recursive: true });
    await mkdir(path.join(mockAgentmanDir, 'bundles'), { recursive: true });
    await mkdir(path.join(mockAgentmanDir, 'tmp'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(mockAgentmanDir, { recursive: true, force: true });
  });

  async function makeBundleZip(
    version: string,
    agentYaml: string,
  ): Promise<{ zipPath: string; sha256: string }> {
    const sourceDir = path.join(workDir, `src-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, 'manifest.json'),
      JSON.stringify({ version, published: '2026-03-26T12:00:00' }),
    );
    const agentDir = path.join(sourceDir, 'agent-release-notes');
    await mkdir(agentDir);
    await writeFile(path.join(agentDir, 'rovo-agent.yaml'), agentYaml);

    const zipPath = path.join(workDir, `${version}-${Date.now()}.zip`);
    await buildZip(sourceDir, zipPath);
    const sha256 = createHash('sha256').update(await readFile(zipPath)).digest('hex');
    return { zipPath, sha256 };
  }

  const v2Yaml = `apiVersion: rovo.atlassian.com/v2-beta
kind: StudioAgent
name: Release Notes Agent
description: Generates structured release notes.
instructions: You are a technical writer.
`;

  const v1Yaml = `apiVersion: rovo.atlassian.com/v1
kind: StudioAgent
identity:
  name: "Release Notes Agent"
  description: "Generates structured release notes."
  behavior: "You are a technical writer."
scenarios:
  default:
    instructions: "Write release notes."
`;

  it('extracts a new bundle and writes content-hash metadata', async () => {
    const { zipPath, sha256 } = await makeBundleZip('0.1.0', v2Yaml);

    const result = await extractBundle(zipPath);

    expect(result.isNew).toBe(true);
    expect(result.manifest.version).toBe('0.1.0');
    expect(result.bundleDir).toBe(path.join(mockAgentmanDir, 'bundles', '0.1.0'));

    const meta = JSON.parse(await readFile(path.join(result.bundleDir, BUNDLE_META_FILE), 'utf-8'));
    expect(meta.sha256).toBe(sha256);
    expect(meta.version).toBe('0.1.0');

    const yaml = await readFile(
      path.join(result.bundleDir, 'agent-release-notes', 'rovo-agent.yaml'),
      'utf-8',
    );
    expect(yaml).toContain('rovo.atlassian.com/v2-beta');
  });

  it('returns a cache hit when version and content hash match', async () => {
    const { zipPath } = await makeBundleZip('0.1.0', v2Yaml);

    const first = await extractBundle(zipPath);
    expect(first.isNew).toBe(true);

    // Re-extract the same zip bytes (copy so path differs but content matches)
    const zipCopy = path.join(workDir, 'same-content.zip');
    await cp(zipPath, zipCopy);
    const second = await extractBundle(zipCopy);

    expect(second.isNew).toBe(false);
    expect(second.bundleDir).toBe(first.bundleDir);
  });

  it('re-extracts when the same version has different zip contents', async () => {
    const stale = await makeBundleZip('0.1.0', v1Yaml);
    const first = await extractBundle(stale.zipPath);
    expect(first.isNew).toBe(true);
    expect(
      await readFile(path.join(first.bundleDir, 'agent-release-notes', 'rovo-agent.yaml'), 'utf-8'),
    ).toContain('rovo.atlassian.com/v1');

    const updated = await makeBundleZip('0.1.0', v2Yaml);
    expect(updated.sha256).not.toBe(stale.sha256);

    const second = await extractBundle(updated.zipPath);
    expect(second.isNew).toBe(true);
    expect(
      await readFile(path.join(second.bundleDir, 'agent-release-notes', 'rovo-agent.yaml'), 'utf-8'),
    ).toContain('rovo.atlassian.com/v2-beta');

    const meta = JSON.parse(await readFile(path.join(second.bundleDir, BUNDLE_META_FILE), 'utf-8'));
    expect(meta.sha256).toBe(updated.sha256);
  });

  it('re-extracts legacy cache directories that lack .bundle.json metadata', async () => {
    const { zipPath, sha256 } = await makeBundleZip('0.1.0', v2Yaml);

    // Simulate a pre-hash cache entry (version dir exists, no meta)
    const legacyDir = path.join(mockAgentmanDir, 'bundles', '0.1.0');
    await mkdir(path.join(legacyDir, 'agent-release-notes'), { recursive: true });
    await writeFile(path.join(legacyDir, 'manifest.json'), JSON.stringify({ version: '0.1.0', published: '2026-03-26T12:00:00' }));
    await writeFile(path.join(legacyDir, 'agent-release-notes', 'rovo-agent.yaml'), v1Yaml);

    const result = await extractBundle(zipPath);
    expect(result.isNew).toBe(true);
    expect(
      await readFile(path.join(result.bundleDir, 'agent-release-notes', 'rovo-agent.yaml'), 'utf-8'),
    ).toContain('rovo.atlassian.com/v2-beta');

    const meta = JSON.parse(await readFile(path.join(result.bundleDir, BUNDLE_META_FILE), 'utf-8'));
    expect(meta.sha256).toBe(sha256);
  });

  it('re-extracts when forceUpdate is set even if the hash matches', async () => {
    const { zipPath } = await makeBundleZip('0.1.0', v2Yaml);
    await extractBundle(zipPath);

    const result = await extractBundle(zipPath, { forceUpdate: true });
    expect(result.isNew).toBe(true);
  });
});
