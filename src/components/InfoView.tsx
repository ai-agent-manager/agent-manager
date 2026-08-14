import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { InstalledSkillRecord } from '../operations/manage.js';

interface InfoViewProps {
  record: InstalledSkillRecord;
  onBack: () => void;
}

export function InfoView({ record, onBack }: InfoViewProps) {
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });

  const pin = record.sourcePin;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Skill info</Text>
      <Text> </Text>
      <Row label="Skill key">{record.installKey}</Row>
      <Row label="Skill ID">{record.skillId}</Row>
      <Row label="Tool">{record.toolId}</Row>
      <Row label="Scope">{record.scope === 'system' ? 'local' : record.scope}</Row>
      {record.repoRoot && <Row label="Repo root">{record.repoRoot}</Row>}
      <Row label="Link name">{record.linkName}</Row>
      <Row label="Method">{record.method}</Row>
      <Row label="Installed">{record.installedAt}</Row>
      {pin ? (
        <>
          <Text> </Text>
          <Text bold>Source</Text>
          <Row label="Type">{pin.sourceType}</Row>
          <Row label="Layout">{pin.installLayout}</Row>
          {pin.repoUrl && <Row label="Repo URL">{pin.repoUrl}</Row>}
          {pin.ref && <Row label="Ref">{pin.ref}</Row>}
          {pin.skillPath && <Row label="Skill path">{pin.skillPath}</Row>}
          {pin.artefactUrl && <Row label="Artefact URL">{pin.artefactUrl}</Row>}
          {pin.artefactVersion && <Row label="Version">{pin.artefactVersion}</Row>}
          {pin.sha256 && <Row label="SHA-256">{pin.sha256}</Row>}
          {pin.bundleBaseUrl && <Row label="Bundle URL">{pin.bundleBaseUrl}</Row>}
          {pin.bundleIndexUrl && <Row label="Index URL">{pin.bundleIndexUrl}</Row>}
          {pin.bundleVersion && <Row label="Bundle ver">{pin.bundleVersion}</Row>}
        </>
      ) : (
        record.version && (
          <>
            <Text> </Text>
            <Text bold>Source</Text>
            <Row label="Type">bundle (legacy)</Row>
            <Row label="Version">{record.version}</Row>
          </>
        )
      )}
      <Text> </Text>
      <Text dimColor> Press Enter or Esc to go back</Text>
    </Box>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Text>
      {'  '}
      <Text dimColor>{label.padEnd(14)}</Text>
      {children}
    </Text>
  );
}
