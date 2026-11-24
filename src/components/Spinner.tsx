import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from './ink/Spinner.js';

interface SpinnerProps {
  message: string;
}

export function LoadingSpinner({ message }: SpinnerProps) {
  return (
    <Box marginLeft={2}>
      <Text color="cyan">
        <InkSpinner />
      </Text>
      <Text> {message}</Text>
    </Box>
  );
}
