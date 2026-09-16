import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseRovoAgentYaml, scanBundle } from '../../../src/bundle/scanner.js';

let root: string;
const yaml = (starters: number) => `apiVersion: rovo.atlassian.com/v2-beta
kind: StudioAgent
name: Example agent
description: Test agent
instructions:
  $file: instructions.md
conversationStarters:
${Array.from({ length: starters }, (_, i) => `  - Starter ${i}`).join('\n')}
`;

beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'agentman-warnings-')); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('scanner warning sinks', () => {
  it('retains the default stderr warning format', async () => {
    await mkdir(path.join(root, 'warning'));
    await writeFile(path.join(root, 'warning', 'instructions.md'), 'Example instructions');
    await writeFile(path.join(root, 'warning', 'rovo-agent.yaml'), yaml(4));
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    await scanBundle(root);
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      '[warn] warning/rovo-agent.yaml: conversationStarters has 4 items but Studio allows max 3 — truncated to first 3\n',
    );
  });

  it('retains each parse warning while asynchronous file references overlap', async () => {
    await writeFile(path.join(root, 'instructions.md'), 'Example instructions');
    const first = vi.fn(); const second = vi.fn();
    await Promise.all([
      parseRovoAgentYaml(yaml(4), root, first),
      parseRovoAgentYaml(yaml(1), root, second),
    ]);
    expect(first).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('truncated'));
    expect(second).not.toHaveBeenCalled();
  });

  it('routes parse and skipped-agent warnings to the supplied sink without stderr', async () => {
    for (const name of ['warning', 'invalid']) await mkdir(path.join(root, name));
    await writeFile(path.join(root, 'warning', 'instructions.md'), 'Example instructions');
    await writeFile(path.join(root, 'warning', 'rovo-agent.yaml'), yaml(4));
    await writeFile(path.join(root, 'invalid', 'rovo-agent.yaml'), 'invalid: true');
    const stderr = vi.spyOn(process.stderr, 'write');
    const warnings: string[] = [];
    const result = await scanBundle(root, undefined, { onWarning: (warning) => warnings.push(warning) });
    expect(result.rovoAgents).toHaveLength(1);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('warning/rovo-agent.yaml: conversationStarters'),
      expect.stringContaining('Skipping invalid/rovo-agent.yaml'),
    ]));
    expect(stderr).not.toHaveBeenCalled();
  });
});
