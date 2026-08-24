import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { filterCatalogue, type CatalogueEntry, type SkillCandidate } from '../discovery/catalogue.js';
import { useListViewport } from '../lib/use-list-viewport.js';

interface DisplayRow {
  entry: CatalogueEntry;
  candidate?: SkillCandidate;
  key: string;
}

function flattenEntries(entries: CatalogueEntry[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (const entry of entries) {
    if (entry.kind === 'skill') {
      for (const candidate of entry.candidates) {
        rows.push({ entry, candidate, key: `${entry.skillId}:${candidate.sourceName}` });
      }
    } else {
      rows.push({ entry, key: `rovo:${entry.skillId}` });
    }
  }
  return rows;
}

interface SkillBrowserProps {
  entries: CatalogueEntry[];
  onSelect: (entry: CatalogueEntry, candidate?: SkillCandidate) => void;
  onBack: () => void;
}

export function SkillBrowser({ entries, onSelect, onBack }: SkillBrowserProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const filtered = filterCatalogue(entries, query);
  const rows = useMemo(() => flattenEntries(filtered), [filtered]);
  const clampedCursor = Math.min(cursor, Math.max(0, rows.length - 1));

  const { start, end, hiddenAbove, hiddenBelow } = useListViewport(rows.length, clampedCursor);
  const visible = rows.slice(start, end);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      const row = rows[clampedCursor];
      if (row) onSelect(row.entry, row.candidate);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, Math.min(c, rows.length - 1) - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(rows.length - 1, c + 1));
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
      <Text bold>Browse agents and skills</Text>
      <Text>
        {'  '}Search: {query}
        <Text inverse> </Text>
      </Text>
      <Text> </Text>
      {rows.length === 0 && <Text dimColor>{'  '}No skills match "{query}".</Text>}
      {hiddenAbove > 0 && <Text dimColor>{'  '}↑ {hiddenAbove} more</Text>}
      {visible.map((row, index) => {
        const actualIndex = start + index;
        const isSelected = actualIndex === clampedCursor;
        return (
          <Box key={row.key} flexDirection="column">
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '❯ ' : '  '}
              {row.entry.displayName}
              {'  '}
              {row.candidate ? (
                <Text dimColor>
                  {row.candidate.sourceType}
                  {row.candidate.sourceStatus && (
                    <>
                      {' · '}
                      <TrustBadge status={row.candidate.sourceStatus} />
                    </>
                  )}
                  {' · '}
                  {row.candidate.sourceName}
                </Text>
              ) : (
                <Text color="magenta">rovo agent</Text>
              )}
            </Text>
            {isSelected && (row.entry.description !== '' || (row.entry.projectNames?.length ?? 0) > 0) && (
              <Box marginLeft={6} flexDirection="column">
                {row.entry.description !== '' && (
                  <Text dimColor>{row.entry.description}</Text>
                )}
                {(row.entry.projectNames?.length ?? 0) > 0 && (
                  <Text dimColor>
                    Projects: {row.entry.projectNames!.join(', ')}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
      {hiddenBelow > 0 && <Text dimColor>{'  '}↓ {hiddenBelow} more</Text>}
      <Text> </Text>
      <Text dimColor>
        {'  '}Type to search · ↑/↓ move · Enter select · Esc back
        {rows.length > 0 && ` · ${clampedCursor + 1}/${rows.length}`}
      </Text>
    </Box>
  );
}

export function TrustBadge({ status }: { status: 'official' | 'community' }) {
  return <Text color={status === 'official' ? 'green' : 'yellow'}>{status}</Text>;
}
