import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';
const SPACE = ' ';

vi.mock('../../../src/config/tools.js', () => ({
  getSkillTools: vi.fn(() => [
    {
      id: 'claude-code',
      name: 'Claude Code',
      getSkillsDir: () => '/home/user/.claude/skills',
      getRepoSkillsDir: (root: string) => `${root}/.claude/skills`,
    },
    {
      id: 'cursor',
      name: 'Cursor',
      getSkillsDir: () => '/home/user/.cursor/skills',
      getRepoSkillsDir: (root: string) => `${root}/.cursor/skills`,
    },
  ]),
}));

const { ToolSelector } = await import('../../../src/components/ToolSelector.js');

async function flushInkInput(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
  stdin.write(input);
  await flushInkInput();
}

describe('ToolSelector', () => {
  it('renders every tool unchecked with a back row', async () => {
    const { lastFrame } = render(
      <ToolSelector scope="system" repoRoot={null} onSelect={() => {}} onBack={() => {}} />,
    );
    await flushInkInput();

    const frame = lastFrame()!;
    expect(frame).toContain('[ ] Claude Code');
    expect(frame).toContain('[ ] Cursor');
    expect(frame).toContain('← Back');
  });

  it('toggles a tool with Space and confirms the selection with Enter', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ToolSelector scope="system" repoRoot={null} onSelect={onSelect} onBack={() => {}} />,
    );
    await flushInkInput();

    await press(stdin, SPACE);
    expect(lastFrame()).toContain('[✓] Claude Code');

    await press(stdin, ENTER);
    expect(onSelect).toHaveBeenCalledWith(['claude-code']);
  });

  it('supports checking multiple tools before confirming', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ToolSelector scope="system" repoRoot={null} onSelect={onSelect} onBack={() => {}} />,
    );
    await flushInkInput();

    await press(stdin, SPACE);
    await press(stdin, DOWN);
    await press(stdin, SPACE);
    expect(lastFrame()).toContain('[✓] Claude Code');
    expect(lastFrame()).toContain('[✓] Cursor');

    await press(stdin, ENTER);
    expect(onSelect).toHaveBeenCalledWith(['claude-code', 'cursor']);
  });

  it('does nothing on Enter when no tool is selected', async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <ToolSelector scope="system" repoRoot={null} onSelect={onSelect} onBack={() => {}} />,
    );
    await flushInkInput();

    await press(stdin, ENTER);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('goes back on Esc', async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <ToolSelector scope="system" repoRoot={null} onSelect={() => {}} onBack={onBack} />,
    );
    await flushInkInput();

    await press(stdin, ESC);
    expect(onBack).toHaveBeenCalled();
  });

  it('goes back when Enter is pressed on the back row', async () => {
    const onBack = vi.fn();
    const { stdin } = render(
      <ToolSelector scope="system" repoRoot={null} onSelect={() => {}} onBack={onBack} />,
    );
    await flushInkInput();

    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    expect(onBack).toHaveBeenCalled();
  });
});
