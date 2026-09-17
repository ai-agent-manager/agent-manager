import { checkOperationCancelled as checkCancelled, rethrowOperationError, withOperationCancellation } from './cancellation.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addSource, classifyStoredSource, getCurrentBundleVersion, readConfig, setCurrentBundle, updateConfig, type StoredSource } from '../bundle/cache.js';
import { downloadBundle } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { importLocalBundle } from '../bundle/importer.js';
import { parseManifest, type BundleManifest } from '../bundle/manifest.js';
import { scanBundle, type BundleContents, type RovoAgentInfo } from '../bundle/scanner.js';
import { resolveSource, resolvePersistedSource, type BundleSource, type StartupSource } from '../bundle/source.js';
import type { RepoSkillSource } from '../bundle/skill-source.js';
import { getBundleVersionDir } from '../config/paths.js';
import { resolveDiscoverySkills, type ResolvedSkill } from '../discovery/index.js';
import { authenticate, getValidBearerToken, type AuthSession, type AuthResult } from '../auth/index.js';
import { isApiAuthFailure, isApiTransientFailure, isProjectsExclusiveSource, listProjects, resolveApiBaseUrl, type Project } from '../api/index.js';
import { resolveCatalogueScope, type CatalogueScope } from '../catalogue-scope/index.js';
import { checkForStartupUpdates, shouldRunStartupUpdateChecks, type StartupUpdateCheckResult } from '../lib/startup-update-checks.js';
import { getBundleSourceTelemetryProperties, setTelemetryDisabledByConfig, trackTelemetryError, trackTelemetryEvent } from '../telemetry.js';

export interface SessionEvents {
  /** Bracket authentication so adapters can expose accurate cancellation phases. */
  runAuth?: <T>(run: () => Promise<T>) => Promise<T>;
  onProgress?: (message: string) => void;
  onAuthPrompt?: (authorizeUrl: string) => void;
  onWarning?: (warning: string) => void;
  signal?: AbortSignal;
}

export interface StartupResolution {
  source?: BundleSource;
  directInstallSource?: RepoSkillSource;
  stored?: StoredSource;
  sourceError?: string;
}

export interface Session extends StartupResolution {
  manifest?: BundleManifest;
  bundleDir?: string;
  bundleContents?: BundleContents;
  discoverySkills?: ResolvedSkill[];
  discoveryBundleVersion?: string;
  authSession?: AuthSession;
  auth: { required: boolean; authenticated: boolean; backend?: AuthResult['backend'] };
  membership: { state: 'not-required' | 'loading' | 'ready' | 'error'; projects: Project[]; error?: string };
  catalogueScope: CatalogueScope;
  warnings: string[];
}

function splitStartupSource(source: StartupSource): StartupResolution {
  return source.type === 'repo' ? { directInstallSource: source } : { source };
}

/** Resolve startup without requiring a renderer. Web callers defer persistence until commit. */
export async function resolveStartupSource(
  input?: string,
  options: { persist?: boolean } = {},
): Promise<StartupResolution> {
  if (input) {
    const resolved = await resolveSource(input);
    const stored = classifyStoredSource(input);
    if (options.persist !== false) await addSource(stored, { setActive: true });
    return { ...splitStartupSource(resolved), stored };
  }
  try {
    const resolved = await resolvePersistedSource();
    return resolved ? { ...splitStartupSource(resolved.source), stored: resolved.stored } : {};
  } catch (error) {
    trackTelemetryError('bundle_source_resolve_failed', error, {
      source: 'persisted', bundleEndpoint: 'persisted-source',
    });
    return { sourceError: error instanceof Error ? error.message : String(error) };
  }
}

export async function acquireBundle(
    source: BundleSource,
    setLoadingMessage: (message: string) => void,
): Promise<{ manifest: BundleManifest; bundleDir: string; isNew: boolean; warning?: string }> {
    if (source.type === "url") {
        setLoadingMessage("Downloading agent bundle...");
        const { zipPath } = await downloadBundle(source.baseUrl);

        setLoadingMessage("Extracting bundle...");
        try {
            return await extractBundle(zipPath, { contentRoot: source.baseUrl });
        } catch (error) {
            trackTelemetryError("bundle_extract_failed", error, getBundleSourceTelemetryProperties(source));
            throw error;
        }
    }

    if (source.type === "directory") {
        setLoadingMessage("Importing local bundle...");
        try {
            return await importLocalBundle(source.dirPath);
        } catch (error) {
            trackTelemetryError("bundle_import_failed", error, getBundleSourceTelemetryProperties(source));
            throw error;
        }
    }

    // type === "discovery" is handled separately via resolveDiscoverySkills
    throw new Error("Discovery sources are resolved via the discovery flow, not acquireBundle");
}

/**
 * Resolve skills from a discovery document, handling authentication if required.
 */
export async function acquireDiscoverySkills(
    source: Extract<BundleSource, { type: 'discovery' }>,
    setLoadingMessage: (message: string) => void,
    onAuthPrompt?: (authorizeUrl: string) => void,
    options: Pick<SessionEvents, "signal" | "onWarning" | "runAuth"> = {},
): Promise<{
    skills: ResolvedSkill[];
    rovoAgents: RovoAgentInfo[];
    warnings: string[];
    bundleVersion?: string;
    manifest?: BundleManifest;
    bundleDir?: string;
    authSession?: AuthSession;
    authBackend?: AuthResult["backend"];
}> {
    const warnings: string[] = [];
    let authSession: AuthSession | undefined;
    let authBackend: AuthResult["backend"];
    checkCancelled(options.signal);

    // Handle authentication if required
    if (source.discovery.auth?.required) {
        setLoadingMessage("Authenticating...");
        const resolveAuth = () => withOperationCancellation(options.signal, () => onAuthPrompt
            ? authenticate(source.baseUrl, source.discovery.auth!, onAuthPrompt,
                ...(options.signal ? [{ signal: options.signal }] : []))
            : getValidBearerToken(source.baseUrl, source.discovery.auth!, { signal: options.signal })
                .then((bearerToken) => ({ bearerToken, fromCache: true })));
        const authResult: AuthResult = await (options.runAuth ? options.runAuth(resolveAuth) : resolveAuth());
        checkCancelled(options.signal);
        authBackend = authResult.backend;
        authSession = {
            discoveryBaseUrl: source.baseUrl,
            auth: source.discovery.auth,
        };
        if (!authResult.fromCache && authResult.backend === 'filesystem') {
            warnings.push("Tokens stored at ~/.agentman/auth/ (OS keychain unavailable, using filesystem with restricted permissions)");
        }
    }

    setLoadingMessage("Resolving skills from discovery document...");
    const result = await resolveDiscoverySkills(
        source.discovery,
        undefined,
        setLoadingMessage,
        authSession || options.signal || options.onWarning
            ? { authSession, ...(options.signal ? { signal: options.signal } : {}),
                ...(options.onWarning ? { onWarning: options.onWarning } : {}) }
            : undefined,
    ).catch((error: unknown) => {
        rethrowOperationError(error, options.signal);
    });

    checkCancelled(options.signal);
    for (const { source, error } of result.errors) {
        warnings.push(`Failed to resolve source '${source.name}': ${error}`);
    }

    return {
        skills: result.skills,
        rovoAgents: result.rovoAgents,
        warnings,
        bundleVersion: result.bundleVersion,
        manifest: result.manifest,
        bundleDir: result.bundleDir,
        authSession,
        authBackend,
    };
}

export async function loadBundleVersion(
  version: string, events: SessionEvents & { source?: BundleSource } = {},
): Promise<{ manifest: BundleManifest; bundleDir: string; bundleContents: BundleContents }> {
  return withOperationCancellation(events.signal, async () => {
    const bundleDir = getBundleVersionDir(version);
    const properties = events.source ? getBundleSourceTelemetryProperties(events.source) : {};
    let manifest: BundleManifest;
    try {
      manifest = parseManifest(await readFile(path.join(bundleDir, 'manifest.json'), 'utf8'));
    } catch (error) {
      checkCancelled(events.signal);
      trackTelemetryError('bundle_manifest_load_failed', error, { ...properties, version });
      throw error;
    }
    checkCancelled(events.signal);
    events.onProgress?.('Scanning bundle contents...');
    try {
      const bundleContents = await scanBundle(bundleDir, manifest.agents, { onWarning: events.onWarning });
      return { manifest, bundleDir, bundleContents };
    } catch (error) {
      checkCancelled(events.signal);
      trackTelemetryError('bundle_scan_failed', error, { ...properties, version: manifest.version });
      throw error;
    }
  });
}

/** Shared wording lets each UI distinguish sign-in failures from retryable outages. */
export function describeMembershipError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  if (isApiAuthFailure(error)) {
    return `Authentication failed while loading project memberships. Sign in again and retry.\n${detail}`;
  }
  if (isApiTransientFailure(error)) {
    return `Temporarily unable to load project memberships for exclusive catalogue filtering. The catalogue is empty until this succeeds.\n${detail}`;
  }
  return `Could not load project memberships for exclusive catalogue filtering:\n${detail}`;
}

/** A failed membership lookup keeps the catalogue restricted to an empty set. */
export async function loadSessionMembership(session: Session, events: SessionEvents = {}): Promise<void> {
  const source = session.source;
  if (source?.type !== 'discovery' || !isProjectsExclusiveSource(source.discovery.projects)) return;
  session.membership = { state: 'loading', projects: [] };
  session.catalogueScope = resolveCatalogueScope({ exclusiveSource: true, membershipProjects: [] });
  try {
    checkCancelled(events.signal);
    const apiBaseUrl = resolveApiBaseUrl(source.discovery.api?.baseUrl);
    if (!apiBaseUrl || !session.authSession) {
      session.membership = { state: 'error', projects: [], error: 'Project membership filtering requires an API base URL and authentication.' };
      return;
    }
    events.onProgress?.('Loading project memberships...');
    const projects = await listProjects(apiBaseUrl, session.authSession, { signal: events.signal });
    checkCancelled(events.signal);
    session.membership = { state: 'ready', projects };
    session.catalogueScope = resolveCatalogueScope({ exclusiveSource: true, membershipProjects: projects });
  } catch (error) {
    checkCancelled(events.signal);
    const message = describeMembershipError(error);
    session.membership = { state: 'error', projects: [], error: message };
    session.warnings.push(message);
    events.onWarning?.(message);
  }
}

/** Load core state. TUI callers may defer membership to keep menus responsive,
 * but must keep the catalogue restricted until loadSessionMembership completes. */
export async function loadSession(
  startup: StartupResolution,
  options: SessionEvents & { forceUpdate?: boolean; persist?: boolean; deferMembership?: boolean } = {},
): Promise<Session> {
  return withOperationCancellation(options.signal, () => loadSessionState(startup, options));
}

async function loadSessionState(
  startup: StartupResolution,
  options: SessionEvents & { forceUpdate?: boolean; persist?: boolean; deferMembership?: boolean },
): Promise<Session> {
  const source = startup.source;
  const required = source?.type === 'discovery' && source.discovery.auth?.required === true;
  const restricted = source?.type === 'discovery' && isProjectsExclusiveSource(source.discovery.projects);
  const session: Session = {
    ...startup,
    auth: { required, authenticated: false },
    membership: { state: restricted ? 'loading' : 'not-required', projects: [] },
    catalogueScope: resolveCatalogueScope({ exclusiveSource: restricted, membershipProjects: [] }),
    warnings: [],
  };
  const warn = (message: string) => {
    session.warnings.push(message);
    options.onWarning?.(message);
  };
  if (startup.directInstallSource) return session;
  if (!source) {
    warn(startup.sourceError
      ? `Could not resolve any configured source:\n${startup.sourceError}`
      : 'No source configured yet. Add one from Manage Sources to get started.');
    return session;
  }
  const config = await readConfig();
  setTelemetryDisabledByConfig(config.telemetryDisabled ?? false);
  checkCancelled(options.signal);
  if (options.persist !== false && (source.type === 'discovery' || source.type === 'url')) {
    await updateConfig((cfg) => { cfg.baseUrl = source.baseUrl; });
  }
  const progress = options.onProgress ?? (() => {});
  if (source.type === 'discovery') {
    const acquired = await acquireDiscoverySkills(source, progress, options.onAuthPrompt,
      { signal: options.signal, onWarning: warn, ...(options.runAuth ? { runAuth: options.runAuth } : {}) });
    session.discoverySkills = acquired.skills;
    session.discoveryBundleVersion = acquired.bundleVersion;
    session.manifest = acquired.manifest;
    session.bundleDir = acquired.bundleDir;
    session.bundleContents = { skills: acquired.skills, rovoAgents: acquired.rovoAgents };
    session.authSession = acquired.authSession;
    session.auth = { required, authenticated: !!acquired.authSession, backend: acquired.authBackend };
    acquired.warnings.forEach(warn);
    if (!options.deferMembership) await loadSessionMembership(session, options);
    return session;
  }
  const currentVersion = await getCurrentBundleVersion();
  if (!currentVersion || options.forceUpdate || source.type === 'directory') {
    const acquired = await acquireBundle(source, progress);
    checkCancelled(options.signal);
    if (acquired.warning) warn(acquired.warning);
    if (acquired.isNew) progress('Setting up new bundle version...');
    session.manifest = acquired.manifest;
    session.bundleDir = acquired.bundleDir;
    if (options.persist !== false) await setCurrentBundle(acquired.manifest.version);
    progress('Scanning bundle contents...');
    try {
      session.bundleContents = await scanBundle(acquired.bundleDir, acquired.manifest.agents, { onWarning: warn });
    } catch (error) {
      checkCancelled(options.signal);
      trackTelemetryError('bundle_scan_failed', error, {
        ...getBundleSourceTelemetryProperties(source), version: acquired.manifest.version,
      });
      throw error;
    }
  } else {
    Object.assign(session, await loadBundleVersion(currentVersion, { ...options, source, onWarning: warn }));
  }
  checkCancelled(options.signal);
  return session;
}

/** Startup notices retain the TUI's legacy-source policy. Discovery returns earlier. */
export async function runStartupChecks(session: Session): Promise<StartupUpdateCheckResult> {
  if (!session.source || session.source.type === 'discovery' || !session.manifest
      || !shouldRunStartupUpdateChecks(await readConfig())) return { notices: [], errors: [] };
  const properties = getBundleSourceTelemetryProperties(session.source);
  const result = await checkForStartupUpdates({
    source: session.source, currentBundleVersion: session.manifest.version,
  });
  for (const failure of result.errors) {
    trackTelemetryError(failure.kind === 'app' ? 'startup_app_update_check_failed' : 'startup_bundle_update_check_failed', failure.error, properties);
  }
  trackTelemetryEvent({ action: 'startup_update_check_completed', properties: {
    ...properties,
    appUpdateAvailable: result.notices.some((notice) => notice.kind === 'app'),
    bundleUpdateAvailable: result.notices.some((notice) => notice.kind === 'bundle'),
    startupCheckErrors: result.errors.length,
  } });
  return result;
}
