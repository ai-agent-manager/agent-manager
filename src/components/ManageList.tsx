import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import SelectInput from 'ink-select-input';
import { listInstalled, type InstalledSkillRecord } from '../operations/manage.js';
import { LoadingSpinner } from './Spinner.js';

interface ManageListProps {
  onSelect: (record: InstalledSkillRecord) => void;
  onBack: () => void;
  /** Increment to force a reload. */
  refreshToken?: number;
}

export function ManageList({ onSelect, onBack, refreshToken }: ManageListProps) {
  const [records, setRecords] = useState<InstalledSkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  useEffect(() => {
    setLoading(true);
    listInstalled('all')
      .then((r) => {
        setRecords(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [refreshToken]);

  if (loading) return <LoadingSpinner message="Loading installed skills..." />;
  if (error) {
    return (
      <Box marginLeft={2}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  const backItem = { label: '← Back', value: null as InstalledSkillRecord | null };

  if (records.length === 0) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text>No skills installed.</Text>
        <Text> </Text>
        <SelectInput items={[backItem]} onSelect={() => onBack()} />
      </Box>
    );
  }

  const nameCol = Math.max(20, Math.floor(termWidth * 0.3));
  const sourceCol = Math.max(16, Math.floor(termWidth * 0.25));

  const items = [
    ...records.map((r) => ({
      key: `${r.toolId}:${r.scope}:${r.installKey}`,
      label: formatRow(r, nameCol, sourceCol),
      value: r as InstalledSkillRecord | null,
    })),
    backItem,
  ];

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Installed skills:</Text>
      <Text dimColor>
        {'  '}
        {pad('SKILL', nameCol)}
        {pad('SOURCE', sourceCol)}
        {'SCOPE  TOOL'}
      </Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (!item.value) {
            onBack();
            return;
          }
          onSelect(item.value);
        }}
      />
    </Box>
  );
}

function formatRow(r: InstalledSkillRecord, nameCol: number, sourceCol: number): string {
  const scope = r.scope === 'system' ? 'local' : r.scope;
  return (
    pad(truncate(r.installKey, nameCol - 2), nameCol) +
    pad(truncate(sourceLabel(r), sourceCol - 2), sourceCol) +
    pad(scope, 7) +
    r.toolId
  );
}

function sourceLabel(r: InstalledSkillRecord): string {
  const version = r.version ? `@${truncate(r.version, 10)}` : '';
  if (!r.sourcePin) return r.version ? `bundle${version} (legacy)` : '(unknown)';
  if (r.sourcePin.sourceType === 'repo') return `repo${version}`;
  if (r.sourcePin.sourceType === 'artefact') return `artefact${version}`;
  return `bundle${version}`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width - 1) + ' ' : s.padEnd(width);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
