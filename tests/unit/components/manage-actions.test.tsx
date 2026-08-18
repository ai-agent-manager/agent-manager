import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import type { InstalledSkillRecord } from '../../../src/operations/manage.js';

const ESC = String.fromCharCode(27);
const DOWN = `${ESC}[B`;
const ENTER = '\r';

const record: InstalledSkillRecord = {
  installKey: 'github.com/example-org/example-repo/my-skill',
  skillId: 'my-skill',
  toolId: 'claude-code',
  scope: 'system',
  sourcePin: {
    sourceType: 'repo',
    installLayout: 'namespaced',
    repoUrl: 'https://github.com/example-org/example-repo',
    ref: 'main',
  },
  version: 'main',
  installedAt: '2026-01-01T00:00:00.000Z',
  method: 'symlink',
  linkName: 'github.com~example-org~example-repo__my-skill',
};

vi.mock('../../../src/operations/manage.js', () => ({
  updateInstalled: vi.fn(async () => ({ installed: [], errors: [] })),
  removeInstalled: vi.fn(async () => ({ removed: [{ name: record.installKey }], errors: [] })),
}));

const { ManageActions } = await import('../../../src/components/ManageActions.js');
const { updateInstalled, removeInstalled } = await import('../../../src/operations/manage.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateInstalled).mockResolvedValue({ installed: [], errors: [] });
  vi.mocked(removeInstalled).mockResolvedValue({ removed: [{ name: record.installKey }], errors: [] });
});

async function flushInkInput(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type Stdin = { write: (input: string) => void };

async function press(stdin: Stdin, input: string): Promise<void> {
  stdin.write(input);
  await flushInkInput();
}

type InteractiveOptions = { onAuthPrompt: (url: string) => void; signal: AbortSignal };

async function renderReady(
  props: {
    onBack?: () => void;
    onDone?: () => void;
    getAccessToken?: (
      contentUrl: string,
      options: InteractiveOptions,
    ) => Promise<string | undefined>;
  } = {},
) {
  const result = render(
    <ManageActions
      record={record}
      onBack={props.onBack ?? (() => {})}
      onDone={props.onDone ?? (() => {})}
      getAccessToken={props.getAccessToken}
    />,
  );
  await vi.waitFor(() => {
    expect(result.lastFrame()).toContain('Update    Re-pull from pinned source');
  });
  await flushInkInput();
  return result;
}

describe('ManageActions', () => {
  it('shows the record header and the action menu', async () => {
    const { lastFrame } = await renderReady();

    expect(lastFrame()).toContain('github.com/example-org/example-repo/my-skill');
    expect(lastFrame()).toContain('scope: local | tool: claude-code');
    expect(lastFrame()).toContain('Remove');
    expect(lastFrame()).toContain('Info');
  });

  it('updates from the pinned source and reports success', async () => {
    const onDone = vi.fn();
    const { lastFrame, stdin } = await renderReady({ onDone });

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✓ Updated my-skill successfully.');
    });
    // toolId is passed so the lookup stays unambiguous when the same skill is
    // installed for more than one tool.
    expect(updateInstalled).toHaveBeenCalledWith(
      record.installKey,
      'system',
      record.toolId,
      undefined,
    );
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });

  it('adapts the interactive provider for update actions, supplying prompt and abort signal', async () => {
    const getAccessToken = vi.fn(async () => 'discovery-token');
    let tokenSeenByUpdate: string | undefined;
    // The mocked operation invokes its provider argument with a protected
    // URL — as the real updateInstalled would — so the adapter is exercised.
    vi.mocked(updateInstalled).mockImplementation(async (_id, _scope, _tool, provider) => {
      tokenSeenByUpdate = await provider?.('https://cdn.example.com/skills/tool.zip');
      return { installed: [], errors: [] };
    });
    const { lastFrame, stdin } = await renderReady({ getAccessToken });

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✓ Updated my-skill successfully.');
    });

    expect(tokenSeenByUpdate).toBe('discovery-token');
    expect(getAccessToken).toHaveBeenCalledWith(
      'https://cdn.example.com/skills/tool.zip',
      expect.objectContaining({
        onAuthPrompt: expect.any(Function),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('shows the inline auth prompt during update and completes after authorisation', async () => {
    const getAccessToken = vi.fn(
      async (_url: string, options: InteractiveOptions) => {
        options.onAuthPrompt('https://identity.example.com/authorize?client_id=agentman');
        await new Promise((r) => setTimeout(r, 50));
        return 'discovery-token';
      },
    );
    vi.mocked(updateInstalled).mockImplementation(async (_id, _scope, _tool, provider) => {
      await provider?.('https://cdn.example.com/skills/tool.zip');
      return { installed: [], errors: [] };
    });
    const { lastFrame, stdin } = await renderReady({ getAccessToken });

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Authentication required');
      expect(lastFrame()).toContain('https://identity.example.com/authorize?client_id=agentman');
    });

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✓ Updated my-skill successfully.');
    });
  });

  it('cancels an in-flight authentication with Escape and lands on a result screen', async () => {
    const onDone = vi.fn();
    const getAccessToken = vi.fn(
      (_url: string, { onAuthPrompt, signal }: InteractiveOptions) =>
        new Promise<string | undefined>((_resolve, reject) => {
          onAuthPrompt('https://identity.example.com/authorize');
          signal.addEventListener(
            'abort',
            () => reject(new Error('Authentication cancelled')),
            { once: true },
          );
        }),
    );
    vi.mocked(updateInstalled).mockImplementation(async (_id, _scope, _tool, provider) => {
      await provider?.('https://cdn.example.com/skills/tool.zip');
      return { installed: [], errors: [] };
    });
    const { lastFrame, stdin } = await renderReady({ getAccessToken, onDone });

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Authentication required');
    });

    await press(stdin, ESC);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✗ Authentication cancelled');
    });

    // Not wedged: the result screen still advances.
    await flushInkInput();
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });

  it('never requests a token for remove or info', async () => {
    const getAccessToken = vi.fn(async () => 'discovery-token');
    const { lastFrame, stdin } = await renderReady({ getAccessToken });

    // Info…
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Skill info');
    });
    await press(stdin, ESC);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Update    Re-pull from pinned source');
    });

    // …and remove, straight through the confirmation.
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Yes, remove my-skill');
    });
    await flushInkInput();
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✓ Removed my-skill.');
    });

    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('surfaces update errors', async () => {
    vi.mocked(updateInstalled).mockRejectedValue(new Error('download failed'));
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✗ download failed');
    });
  });

  it('requires confirmation before removing', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Yes, remove my-skill');
    });
    expect(removeInstalled).not.toHaveBeenCalled();
    await flushInkInput();

    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('✓ Removed my-skill.');
    });
    expect(removeInstalled).toHaveBeenCalledWith(record.installKey, 'system', record.toolId);
  });

  it('cancels removal from the confirm screen', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Yes, remove my-skill');
    });
    await flushInkInput();

    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Update    Re-pull from pinned source');
    });
    expect(removeInstalled).not.toHaveBeenCalled();
  });

  it('opens the info view and returns to the menu', async () => {
    const { lastFrame, stdin } = await renderReady();

    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Skill info');
    });
    await flushInkInput();

    await press(stdin, ESC);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Update    Re-pull from pinned source');
    });
  });

  it('invokes onBack from the back item', async () => {
    const onBack = vi.fn();
    const { stdin } = await renderReady({ onBack });

    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    await press(stdin, ENTER);
    await vi.waitFor(() => {
      expect(onBack).toHaveBeenCalled();
    });
  });
});
