import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface ArtefactCoordinatesInputProps {
  onSubmit: (url: string) => void;
  onBack: () => void;
  error?: string | null;
}

export function ArtefactCoordinatesInput({ onSubmit, onBack, error: externalError }: ArtefactCoordinatesInputProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      setError('URL is required.');
      return;
    }
    if (!trimmed.toLowerCase().endsWith('.zip')) {
      setError('Artefact URL must end with .zip');
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  const shownError = error ?? externalError;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Install from artefact zip</Text>
      <Text> </Text>
      <Box>
        <Text>{'  '}Artefact URL: </Text>
        <TextInput
          value={url}
          onChange={setUrl}
          onSubmit={handleSubmit}
          placeholder="https://cdn.example.com/my-skill-1.0.0.zip"
        />
      </Box>
      {shownError && <Text color="red">{'  '}{shownError}</Text>}
      <Text dimColor>{'  '}Enter URL and press Enter. Esc to go back.</Text>
    </Box>
  );
}
