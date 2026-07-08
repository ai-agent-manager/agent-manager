import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { startServer, DEFAULT_PORT, BIND_HOST, type ServerHandle } from '../server/index.js';
import type { BundleContents } from '../bundle/scanner.js';
import type { BundleManifest } from '../bundle/manifest.js';
import { LoadingSpinner } from './Spinner.js';
import { StatusMessage } from './StatusMessage.js';

interface ChromeExtensionServerProps {
  bundleContents: BundleContents;
  manifest: BundleManifest;
  bundleDir: string;
  onBack: () => void;
}

type ServerState = 'starting' | 'running' | 'error' | 'stopping';

export function ChromeExtensionServer({
  bundleContents,
  manifest,
  bundleDir,
  onBack,
}: ChromeExtensionServerProps) {
  const [state, setState] = useState<ServerState>('starting');
  const [handle, setHandle] = useState<ServerHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start the server on mount
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const ctx = { bundleContents, manifest, bundleDir };
        const h = await startServer(ctx, DEFAULT_PORT);
        if (cancelled) {
          await h.stop();
          return;
        }
        setHandle(h);
        setState('running');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('EADDRINUSE')) {
          setError(`Port ${DEFAULT_PORT} is already in use. Is another instance running?`);
        } else {
          setError(msg);
        }
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Clean up server when unmounting
  useEffect(() => {
    return () => {
      if (handle) {
        handle.stop().catch(() => {});
      }
    };
  }, [handle]);

  const handleStop = useCallback(async () => {
    if (!handle) {
      onBack();
      return;
    }
    setState('stopping');
    try {
      await handle.stop();
    } catch {
      // Ignore errors during shutdown
    }
    onBack();
  }, [handle, onBack]);

  // -------------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------------
  if (state === 'starting') {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Chrome Extension Bridge</Text>
        <Text> </Text>
        <LoadingSpinner message={`Starting server on ${BIND_HOST}:${DEFAULT_PORT}...`} />
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Error
  // -------------------------------------------------------------------------
  if (state === 'error') {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Chrome Extension Bridge</Text>
        <Text> </Text>
        <StatusMessage type="error" message={error ?? 'Unknown error'} />
        <Text> </Text>
        <SelectInput
          items={[{ label: '\u2190 Back to menu', value: 'back' }]}
          onSelect={() => onBack()}
        />
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Stopping
  // -------------------------------------------------------------------------
  if (state === 'stopping') {
    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Chrome Extension Bridge</Text>
        <Text> </Text>
        <LoadingSpinner message="Stopping server..." />
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Chrome Extension Bridge</Text>
      <Text> </Text>
      <StatusMessage type="success" message={`Server running on http://${BIND_HOST}:${handle!.port}`} />
      <Text> </Text>

      <Box flexDirection="column" marginLeft={2}>
        <Text>To connect the Chrome extension:</Text>
        <Text> </Text>
        <Text>  1. Install the Agentman Chrome extension (if you haven't already)</Text>
        <Text>  2. Open the extension popup in Chrome</Text>
        <Text>  3. Enter this auth token when prompted:</Text>
        <Text> </Text>
        <Box marginLeft={4}>
          <Text bold color="cyan">{handle!.token}</Text>
        </Box>
        <Text> </Text>
        <Text dimColor>  The token is valid for this session only. A new token is</Text>
        <Text dimColor>  generated each time the server starts.</Text>
        <Text> </Text>
        <Text dimColor>  Bundle: {manifest.version.slice(0, 7)} ({manifest.published.slice(0, 10)})</Text>
        <Text dimColor>  Agents: {bundleContents.rovoAgents.length} available for provisioning</Text>
      </Box>

      <Text> </Text>
      <SelectInput
        items={[{ label: 'Stop server and return to menu', value: 'stop' }]}
        onSelect={() => handleStop()}
      />
    </Box>
  );
}
