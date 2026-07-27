import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { SkillBrowser, TrustBadge } from './SkillBrowser.js';
import { SkillSourcePicker, candidateCoordinate } from './SkillSourcePicker.js';
import { ScopeSelector } from './ScopeSelector.js';
import { ToolSelector } from './ToolSelector.js';
import { LoadingSpinner } from './Spinner.js';
import { installResolvedSkills } from '../operations/install.js';
import type { CatalogueEntry, SkillCatalogueEntry, SkillCandidate } from '../discovery/catalogue.js';
import type { RovoAgentInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import type { InstallResult } from '../provisioners/types.js';

type FlowScreen =
  | 'browse'
  | 'source-picker'
  | 'scope-selector'
  | 'tool-selector'
  | 'confirm'
  | 'installing'
  | 'result';

interface SkillInstallFlowProps {
  entries: CatalogueEntry[];
  /** Bundle version used when the chosen candidate comes from an http bundle source. */
  bundleVersion: string;
  /** Called when the user picks a Rovo agent — provisioning happens outside this flow. */
  onSelectRovoAgent: (agent: RovoAgentInfo) => void;
  onBack: () => void;
}

export function SkillInstallFlow({ entries, bundleVersion, onSelectRovoAgent, onBack }: SkillInstallFlowProps) {
  const [screen, setScreen] = useState<FlowScreen>('browse');
  const [entry, setEntry] = useState<SkillCatalogueEntry | null>(null);
  const [candidate, setCandidate] = useState<SkillCandidate | null>(null);
  const [scope, setScope] = useState<InstallScope>('system');
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [toolId, setToolId] = useState('');
  const [result, setResult] = useState<InstallResult | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const runInstall = async (selectedToolId: string) => {
    if (!candidate) return;
    setToolId(selectedToolId);
    setScreen('confirm');
  };

  const confirmInstall = async () => {
    if (!candidate) return;
    setScreen('installing');
    try {
      const installResult = await installResolvedSkills({
        skills: [candidate.skill],
        toolId,
        scope,
        repoRoot: repoRoot ?? undefined,
        bundleVersion: candidate.sourceType === 'http' ? bundleVersion : '',
      });
      setResult(installResult);
      setInstallError(null);
    } catch (err) {
      setResult(null);
      setInstallError(err instanceof Error ? err.message : String(err));
    }
    setScreen('result');
  };

  if (screen === 'browse') {
    return (
      <SkillBrowser
        entries={entries}
        onSelect={(selected) => {
          if (selected.kind === 'rovo-agent') {
            onSelectRovoAgent(selected.agent);
            return;
          }
          setEntry(selected);
          setScreen('source-picker');
        }}
        onBack={onBack}
      />
    );
  }

  if (screen === 'source-picker' && entry) {
    return (
      <SkillSourcePicker
        entry={entry}
        onSelect={(selected) => {
          setCandidate(selected);
          setScreen('scope-selector');
        }}
        onBack={() => setScreen('browse')}
      />
    );
  }

  if (screen === 'scope-selector') {
    return (
      <ScopeSelector
        onSelect={(selectedScope, selectedRepoRoot) => {
          setScope(selectedScope);
          setRepoRoot(selectedRepoRoot);
          setScreen('tool-selector');
        }}
        onBack={() => setScreen('source-picker')}
      />
    );
  }

  if (screen === 'tool-selector') {
    return (
      <ToolSelector
        scope={scope}
        repoRoot={repoRoot}
        onSelect={(selectedToolId) => void runInstall(selectedToolId)}
        onBack={() => setScreen('scope-selector')}
      />
    );
  }

  if (screen === 'confirm' && entry && candidate) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Confirm install</Text>
        <Text> </Text>
        <Row label="Skill">{entry.displayName}</Row>
        <Row label="Source">
          {candidate.sourceName} <Text dimColor>({candidate.sourceType})</Text>
          {candidate.sourceStatus && (
            <>
              {' '}
              <TrustBadge status={candidate.sourceStatus} />
            </>
          )}
        </Row>
        <Row label="Coordinate">{candidateCoordinate(candidate)}</Row>
        <Row label="Scope">
          {scope === 'system' ? 'local (home directory)' : `repo (${repoRoot ?? ''})`}
        </Row>
        <Row label="Tool">{toolId}</Row>
        <Row label="Install key">{candidate.installKey}</Row>
        <Text> </Text>
        <SelectInput
          items={[
            { label: 'Install', value: 'install' },
            { label: '← Back', value: 'back' },
          ]}
          onSelect={(item) => {
            if (item.value === 'install') void confirmInstall();
            else setScreen('tool-selector');
          }}
        />
      </Box>
    );
  }

  if (screen === 'installing') {
    return <LoadingSpinner message={`Installing ${entry?.displayName ?? ''}...`} />;
  }

  if (screen === 'result') {
    return (
      <Box flexDirection="column" marginLeft={2}>
        {installError && <Text color="red">✗ {installError}</Text>}
        {result?.installed.map((item) => (
          <Text key={item.name} color="green">
            ✓ {item.name} ({item.method}) → {item.path}
          </Text>
        ))}
        {result?.errors.map((err) => (
          <Text key={err.name} color="red">
            ✗ {err.name}: {err.error}
          </Text>
        ))}
        <Text> </Text>
        <SelectInput
          items={[
            { label: 'Install another skill', value: 'again' },
            { label: '← Back to menu', value: 'menu' },
          ]}
          onSelect={(item) => {
            if (item.value === 'again') {
              setEntry(null);
              setCandidate(null);
              setResult(null);
              setInstallError(null);
              setScreen('browse');
            } else {
              onBack();
            }
          }}
        />
      </Box>
    );
  }

  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Text>
      {'  '}
      <Text dimColor>{label.padEnd(13)}</Text>
      {children}
    </Text>
  );
}
