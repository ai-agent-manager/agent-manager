import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface RepoCoordinates {
  repoUrl: string;
  ref?: string;
}

interface RepoCoordinatesInputProps {
  onSubmit: (coords: RepoCoordinates) => void;
  onBack: () => void;
  error?: string | null;
}

type Field = 'url' | 'ref';

export function RepoCoordinatesInput({ onSubmit, onBack, error: externalError }: RepoCoordinatesInputProps) {
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [activeField, setActiveField] = useState<Field>('url');
  const [error, setError] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const handleUrlSubmit = (val: string) => {
    if (!val.trim()) {
      setError('URL is required.');
      return;
    }
    setError(null);
    setActiveField('ref');
  };

  const handleRefSubmit = () => {
    onSubmit({ repoUrl: url.trim(), ref: ref.trim() || undefined });
  };

  const shownError = error ?? externalError;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Install from GitHub repository</Text>
      <Text> </Text>

      <Box>
        <Text>{'  '}Repository URL: </Text>
        {activeField === 'url' ? (
          <TextInput
            value={url}
            onChange={setUrl}
            onSubmit={handleUrlSubmit}
            placeholder="https://github.com/example-org/example-skills"
          />
        ) : (
          <Text>{url}</Text>
        )}
      </Box>

      {shownError && <Text color="red">{'  '}{shownError}</Text>}

      {activeField === 'ref' ? (
        <>
          <Text> </Text>
          <Box>
            <Text>{'  '}Branch/tag/SHA (blank for default branch): </Text>
            <TextInput value={ref} onChange={setRef} onSubmit={handleRefSubmit} placeholder="main" />
          </Box>
          <Text dimColor>{'  '}Press Enter to continue, Esc to go back</Text>
        </>
      ) : (
        <Text dimColor>{'  '}Enter URL and press Enter. Esc to go back.</Text>
      )}
    </Box>
  );
}
