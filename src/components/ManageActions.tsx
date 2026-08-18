import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { AccessTokenProvider, InstalledSkillRecord } from '../operations/manage.js';
import { updateInstalled, removeInstalled } from '../operations/manage.js';
import type { InteractiveAccessTokenProvider } from '../auth/access-token-provider.js';
import { openInBrowser } from '../auth/index.js';
import { LoadingSpinner } from './Spinner.js';
import { InfoView } from './InfoView.js';
import { AuthPrompt } from './AuthPrompt.js';
import { useEscapeBack } from '../lib/use-escape-back.js';

type Action = 'update' | 'remove' | 'info' | 'back';
type Screen = 'menu' | 'confirm-remove' | 'loading' | 'result' | 'info' | 'auth';

interface ManageActionsProps {
  record: InstalledSkillRecord;
  onBack: () => void;
  onDone: () => void;
  getAccessToken?: InteractiveAccessTokenProvider;
}

export function ManageActions({ record, onBack, onDone, getAccessToken }: ManageActionsProps) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [resultOk, setResultOk] = useState(true);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  // The in-flight update's abort controller. Render-time handlers (AuthPrompt
  // onCancel, unmount cleanup) can only reach it through a ref.
  const controllerRef = useRef<AbortController | null>(null);

  // Unmounting mid-authentication must close the OAuth callback server.
  useEffect(() => () => controllerRef.current?.abort(), []);

  // Adapt the interactive provider (needs a prompt surface and abort signal —
  // both owned here) down to the plain operations-layer provider, keeping
  // UI concerns out of operations/manage.ts.
  const makeUpdateTokenProvider = (): AccessTokenProvider | undefined => {
    if (!getAccessToken) return undefined;
    const controller = new AbortController();
    controllerRef.current = controller;
    return async (contentUrl: string) => {
      try {
        const token = await getAccessToken(contentUrl, {
          onAuthPrompt: (url) => {
            setAuthorizeUrl(url);
            setScreen('auth');
          },
          signal: controller.signal,
        });
        // Return screen: if an interactive prompt was shown, land back on
        // the update spinner (no-op when no prompt appeared).
        setScreen('loading');
        return token;
      } finally {
        setAuthorizeUrl(null);
        // Guard: never clear (or later abort) a newer operation's controller.
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    };
  };

  useInput(
    (_input, key) => {
      if (key.return || key.escape) onDone();
    },
    { isActive: screen === 'result' },
  );

  useEscapeBack(onBack, screen === 'menu');

  const items: Array<{ label: string; value: Action }> = [
    { label: 'Update    Re-pull from pinned source', value: 'update' },
    { label: 'Remove    Remove this skill', value: 'remove' },
    { label: 'Info      View full metadata', value: 'info' },
    { label: '← Back', value: 'back' },
  ];

  const runAction = async (
    verb: 'Updating' | 'Removing',
    action: () => Promise<{ errors: Array<{ error: string }> }>,
    successMessage: string,
  ) => {
    setLoadingMessage(`${verb} ${record.skillId}...`);
    setScreen('loading');
    try {
      const result = await action();
      if (result.errors.length > 0) {
        setResultMessage(`Errors: ${result.errors.map((e) => e.error).join('; ')}`);
        setResultOk(false);
      } else {
        setResultMessage(successMessage);
        setResultOk(true);
      }
    } catch (err) {
      setResultMessage(err instanceof Error ? err.message : String(err));
      setResultOk(false);
    }
    setScreen('result');
  };

  if (screen === 'loading') return <LoadingSpinner message={loadingMessage} />;

  if (screen === 'auth') {
    // authorizeUrl clears momentarily between settlement and the result
    // screen — show the spinner rather than flashing the menu.
    if (!authorizeUrl) return <LoadingSpinner message={loadingMessage} />;
    return (
      <Box flexDirection="column" marginLeft={2}>
        <AuthPrompt
          authorizeUrl={authorizeUrl}
          onOpen={() => openInBrowser(authorizeUrl)}
          onCancel={() => controllerRef.current?.abort()}
        />
      </Box>
    );
  }

  if (screen === 'result') {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text color={resultOk ? 'green' : 'red'}>
          {resultOk ? '✓' : '✗'} {resultMessage}
        </Text>
        <Text dimColor> Press Enter to continue</Text>
      </Box>
    );
  }

  if (screen === 'info') {
    return <InfoView record={record} onBack={() => setScreen('menu')} />;
  }

  if (screen === 'confirm-remove') {
    const confirmItems = [
      { label: `Yes, remove ${record.skillId}`, value: 'yes' },
      { label: 'No, cancel', value: 'no' },
    ];
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text>
          Remove <Text bold>{record.installKey}</Text>?
        </Text>
        <Text> </Text>
        <SelectInput
          items={confirmItems}
          onSelect={(item) => {
            if (item.value === 'yes') {
              void runAction(
                'Removing',
                () => removeInstalled(record.installKey, record.scope, record.toolId),
                `Removed ${record.skillId}.`,
              );
            } else {
              setScreen('menu');
            }
          }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>{record.installKey}</Text>
      <Text dimColor>
        {'  '}scope: {record.scope === 'system' ? 'local' : record.scope} | tool: {record.toolId} | link:{' '}
        {record.linkName}
      </Text>
      <Text> </Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === 'back') {
            onBack();
            return;
          }
          if (item.value === 'update') {
            const provider = makeUpdateTokenProvider();
            void runAction(
              'Updating',
              () =>
                updateInstalled(
                  record.installKey,
                  record.scope,
                  record.toolId,
                  provider,
                ),
              `Updated ${record.skillId} successfully.`,
            );
            return;
          }
          if (item.value === 'remove') {
            setScreen('confirm-remove');
            return;
          }
          setScreen('info');
        }}
      />
    </Box>
  );
}
