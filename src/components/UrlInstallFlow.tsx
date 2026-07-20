import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { InstallSourceMenu, type InstallSourceType } from './InstallSourceMenu.js';
import { RepoCoordinatesInput, type RepoCoordinates } from './RepoCoordinatesInput.js';
import { ArtefactCoordinatesInput } from './ArtefactCoordinatesInput.js';
import { BundleUrlInput } from './BundleUrlInput.js';
import { SourceSkillPicker } from './SourceSkillPicker.js';
import { ScopeSelector } from './ScopeSelector.js';
import { ToolSelector } from './ToolSelector.js';
import { LoadingSpinner } from './Spinner.js';
import { acquireSource, type AcquireResult } from '../operations/install.js';
import {
  resolveSkillSource,
  describeSkillSource,
  deriveSkillInstallKey,
  type SkillSource,
} from '../bundle/skill-source.js';
import { createSkillProvisioner } from '../provisioners/registry.js';
import type { SkillInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import type { InstallResult } from '../provisioners/types.js';

type FlowScreen =
  | 'source-type'
  | 'coords'
  | 'acquiring'
  | 'skill-picker'
  | 'scope-selector'
  | 'tool-selector'
  | 'confirm'
  | 'installing'
  | 'result';

interface UrlInstallFlowProps {
  onBack: () => void;
}

export function UrlInstallFlow({ onBack }: UrlInstallFlowProps) {
  const [screen, setScreen] = useState<FlowScreen>('source-type');
  const [sourceType, setSourceType] = useState<InstallSourceType>('repo');
  const [source, setSource] = useState<SkillSource | null>(null);
  const [acquired, setAcquired] = useState<AcquireResult | null>(null);
  const [selectedSkills, setSelectedSkills] = useState<SkillInfo[]>([]);
  const [scope, setScope] = useState<InstallScope>('system');
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [toolId, setToolId] = useState('');
  const [coordsError, setCoordsError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const acquire = async (input: string) => {
    setScreen('acquiring');
    try {
      const resolved = await resolveSkillSource(input);
      if (resolved.type !== typeForMenu(sourceType)) {
        setCoordsError(
          `Not a ${sourceType} source: ${input} (resolved as ${resolved.type}).`,
        );
        setScreen('coords');
        return;
      }
      const acquireResult = await acquireSource(resolved);
      if (acquireResult.skills.length === 0) {
        setCoordsError('No skills found at that source.');
        setScreen('coords');
        return;
      }
      setSource(resolved);
      setAcquired(acquireResult);
      setCoordsError(null);
      setScreen('skill-picker');
    } catch (err) {
      setCoordsError(err instanceof Error ? err.message : String(err));
      setScreen('coords');
    }
  };

  const confirmInstall = async () => {
    if (!acquired) return;
    setScreen('installing');
    try {
      const provisioner = createSkillProvisioner(toolId, scope, repoRooted());
      const installResult = await provisioner.install(
        selectedSkills,
        acquired.bundleVersion,
        acquired.sourcePin,
      );
      setResult(installResult);
      setInstallError(null);
    } catch (err) {
      setResult(null);
      setInstallError(err instanceof Error ? err.message : String(err));
    }
    setScreen('result');
  };

  const repoRooted = () => (scope === 'repo' ? repoRoot : null);

  if (screen === 'source-type') {
    return (
      <InstallSourceMenu
        onSelect={(selected) => {
          setSourceType(selected);
          setCoordsError(null);
          setScreen('coords');
        }}
        onBack={onBack}
      />
    );
  }

  if (screen === 'coords') {
    const backToMenu = () => {
      setCoordsError(null);
      setScreen('source-type');
    };
    if (sourceType === 'repo') {
      return (
        <RepoCoordinatesInput
          error={coordsError}
          onSubmit={(coords: RepoCoordinates) =>
            void acquire(coords.ref ? `${coords.repoUrl}/tree/${coords.ref}` : coords.repoUrl)
          }
          onBack={backToMenu}
        />
      );
    }
    if (sourceType === 'artefact') {
      return <ArtefactCoordinatesInput error={coordsError} onSubmit={(url) => void acquire(url)} onBack={backToMenu} />;
    }
    return <BundleUrlInput error={coordsError} onSubmit={(input) => void acquire(input)} onBack={backToMenu} />;
  }

  if (screen === 'acquiring') {
    return <LoadingSpinner message="Downloading and scanning source..." />;
  }

  if (screen === 'skill-picker' && source && acquired) {
    return (
      <SourceSkillPicker
        sourceDescription={describeSkillSource(source)}
        skills={acquired.skills}
        onConfirm={(selected) => {
          setSelectedSkills(selected);
          setScreen('scope-selector');
        }}
        onBack={() => setScreen('coords')}
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
        onBack={() => setScreen('skill-picker')}
      />
    );
  }

  if (screen === 'tool-selector') {
    return (
      <ToolSelector
        scope={scope}
        repoRoot={repoRoot}
        onSelect={(selectedToolId) => {
          setToolId(selectedToolId);
          setScreen('confirm');
        }}
        onBack={() => setScreen('scope-selector')}
      />
    );
  }

  if (screen === 'confirm' && source && acquired) {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Confirm install</Text>
        <Text> </Text>
        <Row label="Source">
          {describeSkillSource(source)} <Text dimColor>({source.type})</Text>
        </Row>
        <Row label="Scope">{scope === 'system' ? 'local (home directory)' : `repo (${repoRoot ?? ''})`}</Row>
        <Row label="Tool">{toolId}</Row>
        <Text> </Text>
        <Text>{'  '}Skills:</Text>
        {selectedSkills.map((skill) => (
          <Text key={skill.dirName} dimColor>
            {'    '}
            {deriveSkillInstallKey({ sourcePin: acquired.sourcePin, dirName: skill.dirName })}
          </Text>
        ))}
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
    return <LoadingSpinner message="Installing skills..." />;
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
            { label: 'Install from another URL', value: 'again' },
            { label: '← Back to menu', value: 'menu' },
          ]}
          onSelect={(item) => {
            if (item.value === 'again') {
              setSource(null);
              setAcquired(null);
              setSelectedSkills([]);
              setResult(null);
              setInstallError(null);
              setScreen('source-type');
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

function typeForMenu(menuType: InstallSourceType): SkillSource['type'] {
  if (menuType === 'repo') return 'repo';
  if (menuType === 'artefact') return 'artefact';
  return 'bundle';
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Text>
      {'  '}
      <Text dimColor>{label.padEnd(9)}</Text>
      {children}
    </Text>
  );
}
