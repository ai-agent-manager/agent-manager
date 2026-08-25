import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import {
  listCachedBundles,
  readConfig,
  removeCachedBundle,
  setCurrentBundle,
  updateSkillVersion,
  type AgentmanConfig,
  type CachedBundle,
} from '../bundle/cache.js';
import { downloadBundle, fetchIndex, type IndexEntry } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { readRepoConfig, type RepoAgentmanConfig } from '../bundle/repo-config.js';
import type { BundleSource } from '../bundle/source.js';
import { getSkillTools } from '../config/tools.js';
import { findRepoRoot } from '../lib/repo.js';
import { getValidBearerToken, type AuthSession } from '../auth/index.js';
import {
  getBundleSourceTelemetryProperties,
  trackTelemetryError,
  trackTelemetryEvent,
} from '../telemetry.js';
import { LoadingSpinner } from './Spinner.js';
import { StatusMessage } from './StatusMessage.js';

interface VersionManagerProps {
  currentVersion: string | null;
  source: BundleSource;
  /** When set, refresh a bearer before authenticated index/bundle downloads. */
  authSession?: AuthSession | null;
  onBack: () => void;
  onVersionChanged?: (newVersion: string) => void;
}

type SubScreen =
  | 'overview'
  | 'switch'
  | 'confirm-skill-update'
  | 'cleanup'
  | 'confirm-remove'
  | 'browse';

type MessageType = 'success' | 'warning' | 'error';

export interface BrowseItem {
  label: string;
  value: string;
}

export function buildBrowseItems(
  remoteVersions: IndexEntry[],
  cachedVersions: string[],
  currentVersion: string | null
): BrowseItem[] {
  const cachedSet = new Set(cachedVersions);
  const sorted = [...remoteVersions].reverse();

  return sorted.map((entry) => {
    const isCached = cachedSet.has(entry.version);
    const isCurrent = entry.version === currentVersion;
    const suffix = isCurrent ? '  ● current' : isCached ? '  ✓ cached' : '';

    return {
      label: `${entry.version}  ${entry.published.slice(0, 10)}${suffix}`,
      value: entry.version,
    };
  });
}

export function VersionManager({
  currentVersion,
  source,
  authSession,
  onBack,
  onVersionChanged,
}: VersionManagerProps) {
  const [bundles, setBundles] = useState<CachedBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [subScreen, setSubScreen] = useState<SubScreen>('overview');
  const [config, setConfig] = useState<AgentmanConfig | null>(null);
  const [repoConfig, setRepoConfig] = useState<RepoAgentmanConfig | null>(null);
  const [detectedRepoRoot, setDetectedRepoRoot] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<MessageType>('success');
  const [pendingVersion, setPendingVersion] = useState<string | null>(null);
  const [pendingRemoveVersion, setPendingRemoveVersion] = useState<string | null>(null);
  const [updatingSkills, setUpdatingSkills] = useState(false);
  const [remoteVersions, setRemoteVersions] = useState<IndexEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const bundleTelemetryProps = getBundleSourceTelemetryProperties(source);

  /** Prefer an explicit session; otherwise derive from a discovery source that requires auth. */
  const downloadAuthSession: AuthSession | undefined =
    authSession ??
    (source.type === 'discovery' && source.discovery.auth?.required
      ? { discoveryBaseUrl: source.baseUrl, auth: source.discovery.auth, interactiveMode: true }
      : undefined);

  async function resolveDownloadBearer(requestUrl?: string): Promise<string | undefined> {
    if (!downloadAuthSession) return undefined;
    return getValidBearerToken(
      downloadAuthSession.discoveryBaseUrl,
      downloadAuthSession.auth,
      {
        interactiveMode: downloadAuthSession.interactiveMode,
        requestUrl: requestUrl ?? downloadAuthSession.discoveryBaseUrl,
      },
    );
  }

  useEffect(() => {
    (async () => {
      const [cachedBundles, currentConfig, repoRoot] = await Promise.all([
        listCachedBundles(),
        readConfig(),
        findRepoRoot(),
      ]);
      setBundles(cachedBundles);
      setConfig(currentConfig);
      if (repoRoot) {
        setDetectedRepoRoot(repoRoot);
        setRepoConfig(await readRepoConfig(repoRoot));
      }
      setLoading(false);
    })();
  }, []);

  const refreshBundles = async () => {
    setBundles(await listCachedBundles());
  };

  const refreshConfig = async () => {
    setConfig(await readConfig());
    if (detectedRepoRoot) {
      setRepoConfig(await readRepoConfig(detectedRepoRoot));
    }
  };

  const setStatusMessage = (type: MessageType, value: string) => {
    setMessageType(type);
    setMessage(value);
  };

  const pinnedCountFor = (version: string): number => {
    let count = 0;
    if (config) {
      count += Object.values(config.installations).reduce((total, skills) => {
        return total + Object.values(skills).filter((record) => record.bundleVersion === version).length;
      }, 0);
    }
    if (repoConfig) {
      count += Object.values(repoConfig.installations).reduce((total, skills) => {
        return total + Object.values(skills).filter((record) => record.bundleVersion === version).length;
      }, 0);
    }
    return count;
  };

  useInput(
    (_input, key) => {
      if (!key.escape) return;
      switch (subScreen) {
        case 'overview':
          onBack();
          break;
        case 'browse':
          setBrowseError(null);
          setSubScreen('overview');
          break;
        case 'switch':
          setSubScreen('overview');
          break;
        case 'confirm-skill-update':
          setPendingVersion(null);
          setSubScreen('switch');
          break;
        case 'cleanup':
          setSubScreen('overview');
          break;
        case 'confirm-remove':
          setPendingRemoveVersion(null);
          setSubScreen('cleanup');
          break;
      }
    },
    { isActive: !loading && !updatingSkills && !(subScreen === 'browse' && browseLoading) },
  );

  if (loading) {
    return <LoadingSpinner message="Loading version information..." />;
  }

  if (updatingSkills) {
    return <LoadingSpinner message="Updating installed skills..." />;
  }

  if (subScreen === 'browse') {
    if (browseLoading) {
      return <LoadingSpinner message="Fetching available versions..." />;
    }

    if (browseError) {
      return (
        <Box flexDirection="column" marginLeft={2}>
          <StatusMessage type="error" message={browseError} />
          <Text> </Text>
          <SelectInput
            items={[{ label: '← Back', value: '__back__' }]}
            onSelect={() => {
              setBrowseError(null);
              setSubScreen('overview');
            }}
          />
        </Box>
      );
    }

    if (remoteVersions.length === 0) {
      return (
        <Box flexDirection="column" marginLeft={2}>
          <Text>No versions available remotely.</Text>
          <Text> </Text>
          <SelectInput
            items={[{ label: '← Back', value: '__back__' }]}
            onSelect={() => setSubScreen('overview')}
          />
        </Box>
      );
    }

    const cachedVersionSet = new Set(bundles.map((bundle) => bundle.version));
    const items = [
      ...buildBrowseItems(
        remoteVersions,
        bundles.map((bundle) => bundle.version),
        currentVersion
      ),
      { label: '← Back', value: '__back__' },
    ];

    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Available versions (remote):</Text>
        <Text dimColor> Select a version to download and cache it locally.</Text>
        <Text> </Text>
        <SelectInput
          limit={12}
          items={items}
          onSelect={(item) => {
            if (item.value === '__back__') {
              setSubScreen('overview');
              return;
            }

            const version = item.value;
            if (cachedVersionSet.has(version)) {
              setStatusMessage(
                'warning',
                `Version ${version} is already cached. Use "Switch active version" to activate it.`
              );
              setSubScreen('overview');
              return;
            }

            if (source.type !== 'url') {
              return;
            }

            setBrowseLoading(true);
            (async () => {
              try {
                const bearer = await resolveDownloadBearer(source.baseUrl);
                const { zipPath } = await downloadBundle(source.baseUrl, version, bearer);

                try {
                  await extractBundle(zipPath);
                } catch (error) {
                  trackTelemetryError('bundle_extract_failed', error, {
                    ...bundleTelemetryProps,
                    version,
                  });
                  throw error;
                }

                setStatusMessage('success', `Downloaded and cached version ${version}`);
                await refreshBundles();
                setSubScreen('overview');
              } catch (error) {
                trackTelemetryError('bundle_version_browse_failed', error, {
                  ...bundleTelemetryProps,
                  version,
                });
                setBrowseError(error instanceof Error ? error.message : String(error));
              } finally {
                setBrowseLoading(false);
              }
            })();
          }}
        />
      </Box>
    );
  }

  if (subScreen === 'switch') {
    const items = [
      ...bundles.map((bundle) => ({
        label: `${bundle.version}  ${bundle.published.slice(0, 10)}  ${bundle.isCurrent ? '● current' : ''}`,
        value: bundle.version,
      })),
      { label: '← Back', value: '__back__' },
    ];

    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Switch active bundle version:</Text>
        <Text> </Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === '__back__') {
              setSubScreen('overview');
              return;
            }

            const hasSystemSkills = config
              ? Object.values(config.installations).some((skills) => Object.keys(skills).length > 0)
              : false;
            const hasRepoSkills = repoConfig
              ? Object.values(repoConfig.installations).some((skills) => Object.keys(skills).length > 0)
              : false;
            const hasInstalledSkills = hasSystemSkills || hasRepoSkills;

            if (hasInstalledSkills) {
              setPendingVersion(item.value);
              setSubScreen('confirm-skill-update');
              return;
            }

            (async () => {
              try {
                await setCurrentBundle(item.value);
                trackTelemetryEvent({
                  action: 'bundle_version_switched',
                  properties: { ...bundleTelemetryProps, version: item.value, syncedInstalledSkills: 'false' },
                });
                await refreshBundles();
                onVersionChanged?.(item.value);
                setStatusMessage('success', `Switched to ${item.value}`);
              } catch (error) {
                trackTelemetryError('bundle_version_switch_failed', error, {
                  ...bundleTelemetryProps,
                  version: item.value,
                });
                setStatusMessage('error', error instanceof Error ? error.message : String(error));
              }
              setSubScreen('overview');
            })();
          }}
        />
      </Box>
    );
  }

  if (subScreen === 'confirm-skill-update' && pendingVersion) {
    const items = [
      { label: 'Yes, update all skills to this version  (recommended)', value: 'yes' },
      { label: 'No, keep skills at their current versions', value: 'no' },
      { label: '← Back', value: 'back' },
    ];

    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Switch to bundle {pendingVersion}</Text>
        <Text> </Text>
        <Text>Update all installed skills to this version too?</Text>
        <Text dimColor> Recommended — keeps skills in sync with the active bundle.</Text>
        <Text> </Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === 'back') {
              setPendingVersion(null);
              setSubScreen('switch');
              return;
            }

            (async () => {
              try {
                await setCurrentBundle(pendingVersion);

                let updateFailures: string[] = [];
                if (item.value === 'yes') {
                  setUpdatingSkills(true);

                  // Update system-scoped skills
                  if (config) {
                    for (const [toolId, skills] of Object.entries(config.installations)) {
                      for (const skillName of Object.keys(skills)) {
                        const result = await updateSkillVersion(toolId, skillName, pendingVersion);
                        if (!result.success) {
                          updateFailures.push(`${toolId}/${skillName}: ${result.error ?? 'Unknown error'}`);
                        }
                      }
                    }
                  }

                  // Update repo-scoped skills
                  if (repoConfig && detectedRepoRoot) {
                    for (const [toolId, skills] of Object.entries(repoConfig.installations)) {
                      for (const skillName of Object.keys(skills)) {
                        const result = await updateSkillVersion(toolId, skillName, pendingVersion, {
                          scope: 'repo',
                          repoRoot: detectedRepoRoot,
                        });
                        if (!result.success) {
                          updateFailures.push(`${toolId}/${skillName} (repo): ${result.error ?? 'Unknown error'}`);
                        }
                      }
                    }
                  }

                  await refreshConfig();
                  setUpdatingSkills(false);
                }

                trackTelemetryEvent({
                  action: 'bundle_version_switched',
                  properties: {
                    ...bundleTelemetryProps,
                    version: pendingVersion,
                    syncedInstalledSkills: item.value === 'yes' ? 'true' : 'false',
                    failedUpdates: String(updateFailures.length),
                  },
                });

                await refreshBundles();
                onVersionChanged?.(pendingVersion);

                if (updateFailures.length > 0) {
                  setStatusMessage(
                    'warning',
                    `Switched to ${pendingVersion}, but ${updateFailures.length} skill update(s) failed.`
                  );
                } else if (item.value === 'yes') {
                  setStatusMessage('success', `Switched to ${pendingVersion} — all skills updated`);
                } else {
                  setStatusMessage('success', `Switched to ${pendingVersion}`);
                }
              } catch (error) {
                trackTelemetryError('bundle_version_switch_failed', error, {
                  ...bundleTelemetryProps,
                  version: pendingVersion,
                });
                setStatusMessage('error', error instanceof Error ? error.message : String(error));
              } finally {
                setUpdatingSkills(false);
                setPendingVersion(null);
                setSubScreen('overview');
              }
            })();
          }}
        />
      </Box>
    );
  }

  if (subScreen === 'cleanup') {
    const removable = bundles.filter((bundle) => !bundle.isCurrent);

    if (removable.length === 0) {
      return (
        <Box flexDirection="column" marginLeft={2}>
          <Text>No old bundles to remove.</Text>
          <Text> </Text>
          <SelectInput
            items={[{ label: '← Back', value: '__back__' }]}
            onSelect={() => setSubScreen('overview')}
          />
        </Box>
      );
    }

    const items = [
      ...removable.map((bundle) => {
        const pinned = pinnedCountFor(bundle.version);
        const suffix = pinned > 0 ? `  ⚠ ${pinned} skill(s) pinned` : '';
        return {
          label: `${bundle.version}  ${bundle.published.slice(0, 10)}${suffix}`,
          value: bundle.version,
        };
      }),
      { label: '← Back', value: '__back__' },
    ];

    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Remove old bundles:</Text>
        <Text> </Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === '__back__') {
              setSubScreen('overview');
              return;
            }

            if (pinnedCountFor(item.value) > 0) {
              setPendingRemoveVersion(item.value);
              setSubScreen('confirm-remove');
              return;
            }

            (async () => {
              try {
                await removeCachedBundle(item.value);
                trackTelemetryEvent({
                  action: 'bundle_version_removed',
                  properties: { ...bundleTelemetryProps, version: item.value, pinnedSkills: '0' },
                });
                setStatusMessage('success', `Removed ${item.value}`);
                await refreshBundles();
              } catch (error) {
                trackTelemetryError('bundle_version_remove_failed', error, {
                  ...bundleTelemetryProps,
                  version: item.value,
                });
                setStatusMessage('error', error instanceof Error ? error.message : String(error));
              }
              setSubScreen('overview');
            })();
          }}
        />
      </Box>
    );
  }

  if (subScreen === 'confirm-remove' && pendingRemoveVersion) {
    const pinnedSkills: { toolName: string; skillName: string; scope: string }[] = [];

    if (config) {
      for (const [toolId, skills] of Object.entries(config.installations)) {
        const tool = getSkillTools().find((entry) => entry.id === toolId);
        const toolName = tool?.name ?? toolId;

        for (const [skillName, record] of Object.entries(skills)) {
          if (record.bundleVersion === pendingRemoveVersion) {
            pinnedSkills.push({ toolName, skillName, scope: 'system' });
          }
        }
      }
    }

    if (repoConfig) {
      for (const [toolId, skills] of Object.entries(repoConfig.installations)) {
        const tool = getSkillTools().find((entry) => entry.id === toolId);
        const toolName = tool?.name ?? toolId;

        for (const [skillName, record] of Object.entries(skills)) {
          if (record.bundleVersion === pendingRemoveVersion) {
            pinnedSkills.push({ toolName, skillName, scope: 'repo' });
          }
        }
      }
    }

    const items = [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Remove anyway', value: 'remove' },
    ];

    return (
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>Remove bundle {pendingRemoveVersion}?</Text>
        <Text> </Text>
        <Text color="yellow">This bundle is still referenced by installed skills:</Text>
        {pinnedSkills.map((entry) => (
          <Text key={`${entry.scope}-${entry.toolName}-${entry.skillName}`}>
            {'  '}
            {entry.toolName}: {entry.skillName}{entry.scope === 'repo' ? ' (repo)' : ''}
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>Removing it will leave those skills pointing at a missing bundle version.</Text>
        <Text> </Text>
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item.value === 'cancel') {
              setPendingRemoveVersion(null);
              setSubScreen('cleanup');
              return;
            }

            (async () => {
              try {
                await removeCachedBundle(pendingRemoveVersion);
                trackTelemetryEvent({
                  action: 'bundle_version_removed',
                  properties: {
                    ...bundleTelemetryProps,
                    version: pendingRemoveVersion,
                    pinnedSkills: String(pinnedSkills.length),
                  },
                });
                setStatusMessage(
                  'warning',
                  `Removed ${pendingRemoveVersion}. ${pinnedSkills.length} installed skill(s) still reference it.`
                );
                await refreshBundles();
              } catch (error) {
                trackTelemetryError('bundle_version_remove_failed', error, {
                  ...bundleTelemetryProps,
                  version: pendingRemoveVersion,
                });
                setStatusMessage('error', error instanceof Error ? error.message : String(error));
              }

              setPendingRemoveVersion(null);
              setSubScreen('overview');
            })();
          }}
        />
      </Box>
    );
  }

  const isUrlSource = source.type === 'url';
  const overviewItems = [
    ...(isUrlSource
      ? [
          {
            label: 'Browse available versions    Download a specific version from remote',
            value: 'browse',
          },
        ]
      : []),
    { label: 'Switch active version       Change which bundle version is active', value: 'switch' },
    { label: 'Remove old bundles          Free up disk space', value: 'cleanup' },
    { label: '← Back', value: 'back' },
  ];

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text bold>Version Manager</Text>
      <Text> </Text>
      {message && <StatusMessage type={messageType} message={message} />}
      <Text bold dimColor>
        {' '}
        Cached bundles:
      </Text>
      {bundles.map((bundle) => (
        <Text key={bundle.version}>
          {'    '}
          {bundle.version} {bundle.published.slice(0, 10)} {bundle.isCurrent ? '● active (current)' : ''}
        </Text>
      ))}
      {bundles.length === 0 && <Text dimColor> No bundles cached</Text>}
      <Text> </Text>
      <SelectInput
        items={overviewItems}
        onSelect={(item) => {
          if (item.value === 'back') {
            onBack();
            return;
          }

          if (item.value === 'browse') {
            if (source.type !== 'url') {
              return;
            }

            setBrowseLoading(true);
            setBrowseError(null);
            setSubScreen('browse');
            (async () => {
              try {
                const bearer = await resolveDownloadBearer(source.baseUrl);
                const index = await fetchIndex(source.baseUrl, bearer);
                setRemoteVersions(index.agents);
              } catch (error) {
                trackTelemetryError('bundle_version_index_fetch_failed', error, bundleTelemetryProps);
                setBrowseError(error instanceof Error ? error.message : String(error));
              } finally {
                setBrowseLoading(false);
              }
            })();
            return;
          }

          setSubScreen(item.value as SubScreen);
        }}
      />
    </Box>
  );
}
