import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { InstalledSkillRecord } from '../operations/manage.js';
import { updateInstalled, removeInstalled } from '../operations/manage.js';
import { LoadingSpinner } from './Spinner.js';
import { InfoView } from './InfoView.js';

type Action = 'update' | 'remove' | 'info' | 'back';
type Screen = 'menu' | 'confirm-remove' | 'loading' | 'result' | 'info';

interface ManageActionsProps {
  record: InstalledSkillRecord;
  onBack: () => void;
  onDone: () => void;
}

export function ManageActions({ record, onBack, onDone }: ManageActionsProps) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [resultOk, setResultOk] = useState(true);

  useInput(
    (_input, key) => {
      if (key.return || key.escape) onDone();
    },
    { isActive: screen === 'result' },
  );

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
            void runAction(
              'Updating',
              () => updateInstalled(record.installKey, record.scope, record.toolId),
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
