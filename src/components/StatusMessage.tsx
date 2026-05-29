import React from 'react';
import { Box, Text } from 'ink';

interface StatusMessageProps {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

const ICONS = {
  success: '\u2714',
  error: '\u2718',
  warning: '\u26A0',
  info: '\u2139',
};

const COLORS = {
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'blue',
} as const;

export function StatusMessage({ type, message }: StatusMessageProps) {
  return (
    <Box marginLeft={2}>
      <Text color={COLORS[type]}>{ICONS[type]} {message}</Text>
    </Box>
  );
}
