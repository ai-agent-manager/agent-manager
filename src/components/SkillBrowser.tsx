import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { filterCatalogue, type CatalogueEntry, type SkillCandidate } from '../discovery/catalogue.js';
import { useListViewport } from '../lib/use-list-viewport.js';

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

  const { start, end, hiddenAbove, hiddenBelow } = useListViewport(filtered.length, clampedCursor);
  const visible = filtered.slice(start, end);

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
      {hiddenAbove > 0 && <Text dimColor>{'  '}↑ {hiddenAbove} more</Text>}
      {visible.map((entry, index) => {
        const actualIndex = start + index;
        const isSelected = actualIndex === clampedCursor;
        return (
          <Box key={`${entry.kind}:${entry.skillId}`} flexDirection="column">
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '❯ ' : '  '}
              {entry.displayName}
              {'  '}
              {entry.kind === 'skill' ? (
                <SourceSummary candidates={entry.candidates} />
              ) : (
                <Text color="magenta">rovo agent</Text>
              )}
            </Text>
            {/* Only the highlighted entry shows its description: with one line per
                row the list stays scannable and fits far more entries on screen. */}
            {isSelected && entry.description !== '' && (
              <Text dimColor>
                {'      '}
                {entry.description}
              </Text>
            )}
          </Box>
        );
      })}
      {hiddenBelow > 0 && <Text dimColor>{'  '}↓ {hiddenBelow} more</Text>}
      <Text> </Text>
      <Text dimColor>
        {'  '}Type to search · ↑/↓ move · Enter select · Esc back
        {filtered.length > 0 && ` · ${clampedCursor + 1}/${filtered.length}`}
      </Text>
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
