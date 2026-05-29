import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { featureFlags } from '../lib/feature-flags.js';

export type RovoMethod = 'chrome-extension' | 'command-line';

interface RovoMethodMenuProps {
  onSelect: (method: RovoMethod) => void;
  onBack: () => void;
}

export function RovoMethodMenu({ onSelect, onBack }: RovoMethodMenuProps) {
  const items = [
    ...(featureFlags.chromeExtension
      ? [
          {
            label: 'Use the Chrome Extension     Provision agents from your browser',
            value: 'chrome-extension' as const,
          },
        ]
      : []),
    {
      label: 'Install from the command line Automate via Playwright',
      value: 'command-line' as const,
    },
    { label: '\u2190 Back', value: '__back__' as const },
  ];

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>How would you like to provision Rovo agents?</Text>
      <Text> </Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === '__back__') {
            onBack();
          } else {
            onSelect(item.value);
          }
        }}
      />
    </Box>
  );
}
