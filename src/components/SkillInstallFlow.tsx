import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { SkillBrowser, TrustBadge } from './SkillBrowser.js';
import { candidateCoordinate } from './SkillSourcePicker.js';
import { ScopeSelector } from './ScopeSelector.js';
import { ToolSelector } from './ToolSelector.js';
import { LoadingSpinner } from './Spinner.js';
import {
  installResolvedSkills,
  installResolvedAgents,
  findExistingSkillConflicts,
} from '../operations/install.js';
import { mergeInstallResults } from '../lib/merge-install-results.js';
import { useEscapeBack } from '../lib/use-escape-back.js';
import type { CatalogueEntry, SkillCatalogueEntry, AgentCatalogueEntry, SkillCandidate } from '../discovery/catalogue.js';
import type { RovoAgentInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import type { ExistingSkillPolicy, InstallResult } from '../provisioners/types.js';
import type { AuthSession } from '../auth/index.js';

type FlowScreen =
  | 'browse'
  | 'scope-selector'
  | 'tool-selector'
  | 'confirm'
  | 'installing'
  | 'result';

interface SkillInstallFlowProps {
  entries: CatalogueEntry[];
  /** Bundle version used when the chosen candidate comes from an http bundle source. */
  bundleVersion: string;
  /** Auth session for authenticated bundle downloads. */
  authSession?: AuthSession;
  /** Called when the user picks a Rovo agent — provisioning happens outside this flow. */
  onSelectRovoAgent: (agent: RovoAgentInfo) => void;
  onBack: () => void;
}

export function SkillInstallFlow({ entries, bundleVersion, authSession, onSelectRovoAgent, onBack }: SkillInstallFlowProps) {
  const [screen, setScreen] = useState<FlowScreen>('browse');
  const [entry, setEntry] = useState<SkillCatalogueEntry | AgentCatalogueEntry | null>(null);
  const [candidate, setCandidate] = useState<SkillCandidate | null>(null);
  const [scope, setScope] = useState<InstallScope>('system');
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ toolId: string; names: string[] }>>([]);

  useEscapeBack(() => setScreen('tool-selector'), screen === 'confirm');
  useEscapeBack(onBack, screen === 'result');

  const runInstall = async (selectedToolIds: string[]) => {
    if (!candidate || !entry) return;
    setToolIds(selectedToolIds);
    try {
      setConflicts(
        await findExistingSkillConflicts({
          entry: entry.kind === 'agent'
            ? { kind: 'agent', agent: entry.agent }
            : { kind: 'skill', skill: candidate.skill },
          toolIds: selectedToolIds,
          scope,
          repoRoot: repoRoot ?? undefined,
        }),
      );
    } catch {
      // The install itself still refuses to replace unmanaged skills.
      setConflicts([]);
    }
    setScreen('confirm');
  };

  const confirmInstall = async (existingSkills?: ExistingSkillPolicy) => {
    if (!candidate || !entry) return;
    setScreen('installing');
    try {
      const installResults = await Promise.all(
        toolIds.map((toolId) =>
          entry.kind === 'agent'
            ? installResolvedAgents({
                agents: [entry.agent],
                toolId,
                scope,
                repoRoot: repoRoot ?? undefined,
                bundleVersion: candidate.sourceType === 'http' ? bundleVersion : '',
                bundleUrl: candidate.skill.sourcePin?.bundleBaseUrl,
                authSession,
                existingSkills,
              })
            : installResolvedSkills({
                skills: [candidate.skill],
                toolId,
                scope,
                repoRoot: repoRoot ?? undefined,
                bundleVersion: candidate.sourceType === 'http' ? bundleVersion : '',
                existingSkills,
              }),
        ),
      );
      setResult(mergeInstallResults(installResults));
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
        onSelect={(selected, selectedCandidate) => {
          if (selected.kind === 'rovo-agent') {
            onSelectRovoAgent(selected.agent);
            return;
          }
          setEntry(selected);
          setCandidate(selectedCandidate ?? selected.candidates[0]!);
          setScreen('scope-selector');
        }}
        onBack={onBack}
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
        onBack={() => setScreen('browse')}
      />
    );
  }

  if (screen === 'tool-selector') {
    return (
      <ToolSelector
        scope={scope}
        repoRoot={repoRoot}
        kind={entry?.kind === 'agent' ? 'agent' : 'skill'}
        supportedTools={entry?.kind === 'agent' ? entry.agent.tools : undefined}
        onSelect={(selectedToolId) => void runInstall(selectedToolId)}
        onBack={() => setScreen('scope-selector')}
      />
    );
  }

  if (screen === 'confirm' && entry && candidate) {
    const isAgent = entry.kind === 'agent';
    const confirmItems: Array<{ label: string; value: ExistingSkillPolicy | 'install' | 'back' }> =
      conflicts.length === 0
        ? [
            { label: 'Install', value: 'install' },
            { label: '← Back', value: 'back' },
          ]
        : isAgent
          ? [
              { label: 'Install, using my existing skills as-is', value: 'keep' },
              { label: 'Install, backing up and replacing my existing skills', value: 'backup' },
              { label: '← Back (skip this agent)', value: 'back' },
            ]
          : [
              { label: 'Back up my existing skill and install', value: 'backup' },
              { label: '← Back (keep my existing skill)', value: 'back' },
            ];
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Confirm install</Text>
        <Text> </Text>
        <Row label={entry?.kind === 'agent' ? 'Agent' : 'Skill'}>{entry.displayName}</Row>
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
        <Row label="Tool">{toolIds.join(', ')}</Row>
        {conflicts.length > 0 && (
          <>
            <Text> </Text>
            <Text color="yellow">
              ⚠{' '}
              {isAgent
                ? 'These required skills already exist but were not installed by agentman'
                : 'This skill already exists but was not installed by agentman'}{' '}
              (e.g. a personal or third-party skill):
            </Text>
            {conflicts.map((c) => (
              <Text key={c.toolId} color="yellow">
                {'    '}
                {c.toolId}: {c.names.join(', ')}
              </Text>
            ))}
            <Text dimColor>    Backups are moved to ~/.agentman/backups.</Text>
          </>
        )}
        <Text> </Text>
        <SelectInput
          items={confirmItems}
          onSelect={(item) => {
            if (item.value === 'back') setScreen('tool-selector');
            else void confirmInstall(item.value === 'install' ? undefined : item.value);
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
          <Text key={item.path} color="green">
            ✓ {item.name} ({item.method}) → {item.path}
          </Text>
        ))}
        {result?.errors.map((err, index) => (
          <Text key={`${err.name}-${index}`} color="red">
            ✗ {err.name}: {err.error}
          </Text>
        ))}
        {result?.warnings?.map((warning, index) => (
          <Text key={`warning-${index}`} color="yellow">
            ⚠ {warning}
          </Text>
        ))}
        <Text> </Text>
        <SelectInput
          items={[
            { label: `Install another ${entry?.kind === 'agent' ? 'agent' : 'skill'}`, value: 'again' },
            { label: '← Back to menu', value: 'menu' },
          ]}
          onSelect={(item) => {
            if (item.value === 'again') {
              setEntry(null);
              setCandidate(null);
              setResult(null);
              setInstallError(null);
              setConflicts([]);
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
