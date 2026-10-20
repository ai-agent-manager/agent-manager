import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { getSkillTools } from '../config/tools.js';
import { getAgentTools } from '../provisioners/agent-registry.js';
import type { InstallScope } from '../config/scopes.js';

interface ToolSelectorProps {
  scope: InstallScope;
  repoRoot: string | null;
  /** When set, only these tool IDs are shown (e.g. tools an agent package supports). */
  supportedTools?: string[];
  /** Whether installing skills or agents. */
  kind?: 'skill' | 'agent';
  onSelect: (toolIds: string[]) => void;
  onBack: () => void;
}

export function ToolSelector({ scope, repoRoot, supportedTools, kind = 'skill', onSelect, onBack }: ToolSelectorProps) {
  const allTools = kind === 'agent' ? getAgentTools() : getSkillTools();
  const tools = supportedTools && supportedTools.length > 0
    ? allTools.filter((tool) => supportedTools.includes(tool.id))
    : allTools;
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
  const kindLabel = kind === 'agent' ? 'agents' : 'skills';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Which tool do you want to install {kindLabel} for? <Text dimColor>({scopeLabel})</Text></Text>
      <Text> </Text>
      {tools.map((tool, index) => {
        // TypeScript can't narrow the union type based on 'kind', but we know the method exists at runtime
        const dir = scope === 'repo' && repoRoot
          ? kind === 'agent'
            ? (tool as any).getRepoAgentsDir(repoRoot)
            : (tool as any).getRepoSkillsDir(repoRoot)
          : kind === 'agent'
            ? (tool as any).getAgentsDir()
            : (tool as any).getSkillsDir();

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
