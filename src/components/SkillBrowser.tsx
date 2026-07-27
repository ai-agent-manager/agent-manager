import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { filterCatalogue, type CatalogueEntry, type SkillCandidate } from '../discovery/catalogue.js';

interface SkillBrowserProps {
  entries: CatalogueEntry[];
  onSelect: (entry: CatalogueEntry) => void;
  onBack: () => void;
}

export function SkillBrowser({ entries, onSelect, onBack }: SkillBrowserProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const filtered = filterCatalogue(entries, query);
  const clampedCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      const entry = filtered[clampedCursor];
      if (entry) onSelect(entry);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, Math.min(c, filtered.length - 1) - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setCursor(0);
    }
  });

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Browse skills</Text>
      <Text>
        {'  '}Search: {query}
        <Text inverse> </Text>
      </Text>
      <Text> </Text>
      {filtered.length === 0 && <Text dimColor>{'  '}No skills match "{query}".</Text>}
      {filtered.map((entry, index) => (
        <Box key={`${entry.kind}:${entry.skillId}`} flexDirection="column">
          <Text color={index === clampedCursor ? 'cyan' : undefined}>
            {index === clampedCursor ? '❯ ' : '  '}
            {entry.displayName}
            {'  '}
            {entry.kind === 'skill' ? (
              <SourceSummary candidates={entry.candidates} />
            ) : (
              <Text color="magenta">rovo agent</Text>
            )}
          </Text>
          {entry.description !== '' && (
            <Text dimColor>
              {'      '}
              {entry.description}
            </Text>
          )}
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>{'  '}Type to search · ↑/↓ move · Enter select · Esc back</Text>
    </Box>
  );
}

function SourceSummary({ candidates }: { candidates: SkillCandidate[] }) {
  if (candidates.length > 1) {
    return <Text dimColor>({candidates.length} sources)</Text>;
  }
  const candidate = candidates[0]!;
  return (
    <Text dimColor>
      {candidate.sourceType}
      {candidate.sourceStatus && (
        <>
          {' · '}
          <TrustBadge status={candidate.sourceStatus} />
        </>
      )}
    </Text>
  );
}

export function TrustBadge({ status }: { status: 'official' | 'community' }) {
  return <Text color={status === 'official' ? 'green' : 'yellow'}>{status}</Text>;
}
