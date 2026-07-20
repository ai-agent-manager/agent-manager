import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

export type InstallSourceType = 'repo' | 'artefact' | 'bundle';
type MenuItem = InstallSourceType | '__back__';

interface InstallSourceMenuProps {
  onSelect: (source: InstallSourceType) => void;
  onBack: () => void;
}

export function InstallSourceMenu({ onSelect, onBack }: InstallSourceMenuProps) {
  const items: Array<{ label: string; value: MenuItem }> = [
    { label: 'GitHub Repository        Install skills from a GitHub repo URL', value: 'repo' },
    { label: 'Artefact (zip)           Install a packaged skill from a zip URL', value: 'artefact' },
    { label: 'Bundle                   Install from a bundle base URL or local directory', value: 'bundle' },
    { label: '← Back', value: '__back__' },
  ];

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Install from URL — select source type:</Text>
      <Text> </Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === '__back__') {
            onBack();
            return;
          }
          onSelect(item.value);
        }}
      />
    </Box>
  );
}
