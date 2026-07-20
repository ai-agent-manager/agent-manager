import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SkillInfo } from '../bundle/scanner.js';

interface SourceSkillPickerProps {
  /** Header line describing the acquired source (e.g. describeSkillSource output). */
  sourceDescription: string;
  skills: SkillInfo[];
  onConfirm: (selected: SkillInfo[]) => void;
  onBack: () => void;
}

export function SourceSkillPicker({ sourceDescription, skills, onConfirm, onBack }: SourceSkillPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(skills.map((s) => s.dirName)));
  const [cursor, setCursor] = useState(0);
  const totalRows = skills.length + 1;

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(totalRows - 1, c + 1));
      return;
    }
    if (input === ' ' && cursor < skills.length) {
      const skill = skills[cursor]!;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(skill.dirName)) next.delete(skill.dirName);
        else next.add(skill.dirName);
        return next;
      });
      return;
    }
    if (key.return) {
      if (cursor === skills.length) {
        onBack();
        return;
      }
      const toInstall = skills.filter((s) => selected.has(s.dirName));
      if (toInstall.length === 0) return;
      onConfirm(toInstall);
    }
  });

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Select skills to install:</Text>
      <Text dimColor>{'  '}{sourceDescription}</Text>
      <Text> </Text>
      {skills.map((skill, i) => {
        const isCursor = i === cursor;
        const isSelected = selected.has(skill.dirName);
        const name = skill.meta?.name ?? skill.dirName;
        const desc = skill.meta?.description ?? '';
        return (
          <Text key={skill.dirName}>
            {isCursor ? '  ❯ ' : '    '}
            {isSelected ? '[✓]' : '[ ]'} {name.padEnd(28)}
            <Text dimColor>{desc.slice(0, 40)}</Text>
          </Text>
        );
      })}
      <Text>
        {cursor === skills.length ? '  ❯ ' : '    '}
        {'← Back'}
      </Text>
      <Text> </Text>
      <Text dimColor>{'  '}Space to select/deselect, Enter to install selected, Esc to go back</Text>
    </Box>
  );
}
