import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

interface AuthPromptProps {
  /** The authorization URL the user should visit. */
  authorizeUrl: string;
  /** Called when the user presses Enter to open the URL in the browser. */
  onOpen: () => void;
  /** When provided, Escape cancels the flow (the caller must abort the wait). */
  onCancel?: () => void;
}

/**
 * TUI component that displays an OAuth authorization URL and lets the
 * user either copy it or press Enter to open it in their default browser.
 */
export function AuthPrompt({ authorizeUrl, onOpen, onCancel }: AuthPromptProps) {
  const [opened, setOpened] = useState(false);

  useInput(useCallback((_input: string, key: { return?: boolean; escape?: boolean }) => {
    if (key.return && !opened) {
      setOpened(true);
      onOpen();
    }
    if (key.escape && onCancel) {
      onCancel();
    }
  }, [opened, onOpen, onCancel]));

  return (
    <Box flexDirection="column" marginY={1} marginLeft={2}>
      <Text color="yellow">
        {'\u26A0'} Authentication required
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Open this URL to authorise agent-manager:</Text>
        <Box marginTop={1}>
          <Text color="cyan" underline>{authorizeUrl}</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        {opened ? (
          <Text color="green">
            {'\u2714'} Opened in browser — waiting for authorisation...
            {onCancel ? ' Press Esc to cancel.' : ''}
          </Text>
        ) : (
          <Text dimColor>
            Press <Text bold>Enter</Text> to open in browser, or copy the URL above.
            {onCancel ? ' Press Esc to cancel.' : ''}
          </Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Tokens will be stored in your OS keychain, or ~/.agentman/auth/ (restricted permissions) if no keychain is available
        </Text>
      </Box>
    </Box>
  );
}
