import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface BundleUrlInputProps {
  onSubmit: (input: string) => void;
  onBack: () => void;
  error?: string | null;
}

export function BundleUrlInput({ onSubmit, onBack, error: externalError }: BundleUrlInputProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const handleSubmit = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      setError('Bundle URL or directory path is required.');
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  const shownError = error ?? externalError;

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Install from bundle</Text>
      <Text> </Text>
      <Box>
        <Text>{'  '}Bundle base URL or local directory: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="https://bundles.example.com or ./my-bundle"
        />
      </Box>
      {shownError && <Text color="red">{'  '}{shownError}</Text>}
      <Text dimColor>{'  '}Direct bundle base URL (not a discovery document URL). Esc to go back.</Text>
    </Box>
  );
}
