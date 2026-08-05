import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import type { SkillCatalogueEntry, SkillCandidate } from '../discovery/catalogue.js';

interface SkillSourcePickerProps {
  entry: SkillCatalogueEntry;
  onSelect: (candidate: SkillCandidate) => void;
  onBack: () => void;
}

const BACK = '__back__';

export function SkillSourcePicker({ entry, onSelect, onBack }: SkillSourcePickerProps) {
  const [highlighted, setHighlighted] = useState<SkillCandidate | null>(entry.candidates[0] ?? null);

  const items = [
    ...entry.candidates.map((candidate, index) => ({
      key: `${candidate.sourceName}-${index}`,
      label: candidateLabel(candidate),
      value: index as number | typeof BACK,
    })),
    { key: BACK, label: '← Back', value: BACK as number | typeof BACK },
  ];

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>{entry.displayName}</Text>
      {entry.description !== '' && <Text dimColor>{'  '}{entry.description}</Text>}
      <Text> </Text>
      <Text>Choose a source:</Text>
      <SelectInput
        limit={12}
        items={items}
        onSelect={(item) => {
          if (item.value === BACK) {
            onBack();
            return;
          }
          onSelect(entry.candidates[item.value]!);
        }}
        onHighlight={(item) => {
          setHighlighted(item.value === BACK ? null : entry.candidates[item.value]!);
        }}
      />
      {highlighted && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{'  '}Coordinate:  {candidateCoordinate(highlighted)}</Text>
          <Text dimColor>{'  '}Install key: {highlighted.installKey}</Text>
        </Box>
      )}
    </Box>
  );
}

function candidateLabel(candidate: SkillCandidate): string {
  const type = sourceTypeLabel(candidate.sourceType);
  return `${candidate.sourceName.padEnd(24)}${type.padEnd(13)}${candidate.sourceStatus ?? ''}`;
}

function sourceTypeLabel(type: SkillCandidate['sourceType']): string {
  if (type === 'git') return 'git';
  if (type === 'artefact') return 'artefact';
  return 'http bundle';
}

export function candidateCoordinate(candidate: SkillCandidate): string {
  const pin = candidate.skill.sourcePin;
  if (!pin) return '(current bundle)';
  if (pin.sourceType === 'repo' && pin.repoUrl) {
    return pin.ref ? `${pin.repoUrl}@${pin.ref}` : pin.repoUrl;
  }
  if (pin.sourceType === 'artefact' && pin.artefactUrl) {
    return pin.artefactVersion ? `${pin.artefactUrl} (${pin.artefactVersion})` : pin.artefactUrl;
  }
  if (pin.sourceType === 'bundle') {
    return pin.bundleBaseUrl
      ? pin.bundleVersion
        ? `${pin.bundleBaseUrl} (v${pin.bundleVersion})`
        : pin.bundleBaseUrl
      : '(local bundle)';
  }
  return '(unknown)';
}
