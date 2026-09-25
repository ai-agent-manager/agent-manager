import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, cp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillVersionManager } from '../../../src/components/SkillVersionManager.js';
import { importLocalBundle } from '../../../src/bundle/importer.js';

let home: string;
let directory: string;
let menu: { items: { label: string; value: string }[]; onSelect: (item: { label: string; value: string }) => void };
vi.mock('../../../src/lib/platform.js', async (original) => ({ ...await original<typeof import('../../../src/lib/platform.js')>(), getHomeDir: () => home }));
vi.mock('../../../src/lib/repo.js', () => ({ findRepoRoot: async () => null }));
vi.mock('ink-select-input', () => ({ default: (props: typeof menu) => { menu = props; return <Text>{props.items.map((item) => item.label).join('\n')}</Text>; } }));

beforeEach(async () => {
  home = await mkdtemp(path.join(await realpath(os.tmpdir()), 'agentman-version-ui-'));
  directory = path.join(home, 'source');
  await mkdir(path.join(directory, 'skill'), { recursive: true });
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: '1.0.0', published: '2026-01-01' }));
  await writeFile(path.join(directory, 'skill', 'SKILL.md'), '# Skill');
  await mkdir(path.join(home, '.agentman', 'bundles'), { recursive: true });
  await cp(directory, path.join(home, '.agentman', 'bundles', '1.0.0'), { recursive: true });
  await writeFile(path.join(home, '.agentman', 'config.json'), JSON.stringify({ installations: { 'claude-code': { skill: {
    installedAt: '', method: 'symlink', bundleVersion: '1.0.0', sourcePin: { sourceType: 'bundle', installLayout: 'flat', bundleVersion: '1.0.0' },
  } } } }));
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

async function choose(value: string) {
  await vi.waitFor(() => expect(menu.items.some((item) => item.value === value)).toBe(true));
  menu.onSelect(menu.items.find((item) => item.value === value)!);
}

it.each([false, true])('shows real provenance support for a legacy directory cache (adopted=%s)', async (adopted) => {
  if (adopted) await importLocalBundle(directory);
  const view = render(<SkillVersionManager onBack={() => {}} />);
  try {
    await choose('system'); await choose('skill');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Change Version: skill'));
    if (adopted) {
      expect(menu.items.some((item) => item.value === '1.0.0')).toBe(true);
    } else {
      expect(view.lastFrame()).toContain('Download or import it again');
      expect(view.lastFrame()).not.toContain(home);
      expect(menu.items.map((item) => item.value)).toEqual(['__back__']);
    }
  } finally { view.unmount(); }
});
