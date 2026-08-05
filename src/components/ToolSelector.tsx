import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getSkillTools } from '../config/tools.js';
import type { InstallScope } from '../config/scopes.js';

interface ToolSelectorProps {
  scope: InstallScope;
  repoRoot: string | null;
  onSelect: (toolIds: string[]) => void;
  onBack: () => void;
}

export function ToolSelector({ scope, repoRoot, onSelect, onBack }: ToolSelectorProps) {
  const tools = getSkillTools();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((current) => Math.max(0, current - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((current) => Math.min(tools.length, current + 1));
      return;
    }

    if (input === ' ' && cursor < tools.length) {
      const tool = tools[cursor]!;
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(tool.id)) {
          next.delete(tool.id);
        } else {
          next.add(tool.id);
        }
        return next;
      });
      return;
    }

    if (key.return) {
      if (cursor === tools.length) {
        onBack();
        return;
      }

      if (selected.size === 0) {
        return;
      }

      onSelect(tools.filter((tool) => selected.has(tool.id)).map((tool) => tool.id));
      return;
    }

    if (key.escape) {
      onBack();
    }
  });

  const scopeLabel = scope === 'repo' ? 'this repository' : 'system-wide';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Which tool do you want to install skills for? <Text dimColor>({scopeLabel})</Text></Text>
      <Text> </Text>
      {tools.map((tool, index) => {
        const dir = scope === 'repo' && repoRoot ? tool.getRepoSkillsDir(repoRoot) : tool.getSkillsDir();

        // For display: show repo-relative path for repo scope, home-relative for system
        const displayDir = scope === 'repo' && repoRoot
          ? dir.replace(repoRoot, '.')
          : dir.replace(process.env.HOME ?? '~', '~');

        const isSelected = selected.has(tool.id);
        const isCursor = index === cursor;

        return (
          <Text key={tool.id}>
            {isCursor ? '  ❯ ' : '    '}
            {isSelected ? '[✓]' : '[ ]'} {tool.name.padEnd(22)}
            <Text dimColor>{displayDir}/</Text>
          </Text>
        );
      })}
      <Text>
        {cursor === tools.length ? '  ❯ ' : '    '}
        {'← Back'}
      </Text>
      <Text> </Text>
      <Text dimColor> Space to check/uncheck, Enter to confirm, Esc to go back</Text>
    </Box>
  );
}
