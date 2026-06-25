import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { getSkillTools } from '../config/tools.js';
import type { InstallScope } from '../config/scopes.js';

interface ToolSelectorProps {
  scope: InstallScope;
  repoRoot: string | null;
  onSelect: (toolId: string) => void;
  onBack: () => void;
}

export function ToolSelector({ scope, repoRoot, onSelect, onBack }: ToolSelectorProps) {
  const items = [
    ...getSkillTools().map((tool) => {
      const dir = scope === 'repo' && repoRoot
        ? tool.getRepoSkillsDir(repoRoot)
        : tool.getSkillsDir();

      // For display: show repo-relative path for repo scope, home-relative for system
      const displayDir = scope === 'repo' && repoRoot
        ? dir.replace(repoRoot, '.')
        : dir.replace(process.env.HOME ?? '~', '~');

      return {
        label: `${tool.name.padEnd(22)}${displayDir}/`,
        value: tool.id,
      };
    }),
    {
      label: '\u2190 Back',
      value: '__back__',
    },
  ];

  const scopeLabel = scope === 'repo' ? 'this repository' : 'system-wide';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Which tool do you want to install skills for? <Text dimColor>({scopeLabel})</Text></Text>
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
