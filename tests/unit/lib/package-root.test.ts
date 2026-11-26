import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findPackageRoot, packageRoot } from '../../../src/lib/package-root.js';

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('package root', () => {
  it('walks past unrelated package.json files to our own manifest', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentman-root-'));
    const root = path.join(directory, 'node_modules', '@ai-agent-manager', 'cli');
    const chunks = path.join(root, 'dist', 'chunks');
    await mkdir(chunks, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'consumer' }));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@ai-agent-manager/cli' }));
    await writeFile(path.join(root, 'dist', 'package.json'), JSON.stringify({ type: 'module' }));
    expect(findPackageRoot(chunks)).toBe(root);
  });

  it('fails clearly when the package is not an ancestor', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'agentman-root-'));
    expect(() => findPackageRoot(directory!)).toThrow('Could not locate the @ai-agent-manager/cli package root');
  });

  it('resolves the checkout when running from source', () => {
    expect(packageRoot()).toBe(path.resolve(import.meta.dirname, '../../..'));
  });
});
