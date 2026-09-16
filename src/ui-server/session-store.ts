import path from 'node:path';
import { addSource, setCurrentBundle, updateConfig } from '../bundle/cache.js';
import { loadSession, resolveStartupSource, runStartupChecks, type Session } from '../operations/session.js';
import { buildSessionCatalogue, buildRepositoryCatalogue, effectiveBundleVersion } from '../operations/catalogue.js';
import { checkOperationCancelled } from '../operations/cancellation.js';
import { withMutation } from '../lib/mutation.js';
import { deleteTokens, type TokenStoreIdentity } from '../auth/token-store.js';
import { withAuthCoordinator } from '../auth/coordinator.js';
import type { SkillCandidate } from '../discovery/catalogue.js';
import type { InstallScope } from '../config/scopes.js';
import { catalogueDto, safeText, safeUrl, sourceDto } from './dto.js';
import { ConflictError, HttpError, serialiseError } from './errors.js';
import { JobRegistry } from './jobs.js';
import type { SessionDto } from './api-types.js';

export class SessionStore {
  private session?: Session;
  private dto: SessionDto = {
    state: 'idle', sessionRevision: 0, auth: { required: false, authenticated: false },
    membership: { state: 'not-required' }, catalogue: [], warnings: [], startupNotices: [],
  };
  private gate = Promise.resolve();
  private signingOut = false;
  private identities = new Map<string, TokenStoreIdentity>();
  constructor(private jobs: JobRegistry, private cwd: string, private changed: (dto: SessionDto) => void) {}
  snapshot(): SessionDto { return structuredClone(this.dto); }
  current(): Session | undefined { return this.session; }
  private publish(): void { this.changed(this.snapshot()); }
  /** Orders revision acceptance with persistence/install commits, never network I/O. */
  async exclusive<T>(run: () => Promise<T> | T): Promise<T> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await run(); } finally { release(); }
  }
  assertRevision(revision: number): Session {
    if (revision !== this.dto.sessionRevision || this.dto.state !== 'ready' || !this.session) {
      throw new ConflictError('The catalogue changed. Refresh and select the skill again.', 'STALE_SESSION');
    }
    return this.session;
  }
  assertAuthAvailable(): void {
    if (this.signingOut) throw new ConflictError('Sign-out is in progress.', 'AUTH_BUSY');
  }
  normaliseInput(input: string): string {
    return /^(https?:\/\/|git@)/i.test(input) ? input : path.resolve(this.cwd, input);
  }
  async changeSource(run: () => Promise<void>, invalidate: boolean): Promise<void> {
    await withMutation(() => this.exclusive(async () => {
      this.assertAuthAvailable();
      await run();
      if (invalidate) {
        this.dto.sessionRevision++; this.dto.state = 'idle'; this.dto.catalogue = [];
        this.dto.auth = { required: false, authenticated: false };
        this.dto.membership = { state: 'not-required' };
        this.dto.source = undefined; this.dto.stored = undefined; this.dto.bundle = undefined;
        this.dto.bundleVersion = undefined; this.dto.warnings = []; this.dto.error = undefined;
        this.dto.startupNotices = [];
        this.session = undefined; this.publish();
      }
    }));
  }
  async load(input?: string, forceUpdate = false): Promise<string> {
    return this.exclusive(() => {
      this.assertAuthAvailable();
      const revision = this.dto.sessionRevision + 1;
      const oldJobId = this.dto.loadJobId;
      const id = this.jobs.start('session-load', async (ctx) => {
        try {
          ctx.phase('resolving');
          const startup = await resolveStartupSource(input ? this.normaliseInput(input) : undefined, { persist: false }).catch((error: unknown) => {
            if (serialiseError(error).status !== 500) throw error;
            throw new HttpError(422, 'Could not load the selected source. Check that its directory exists or its URL is reachable, then correct it in Sources and reload.', 'SOURCE_LOAD_FAILED');
          });
          if (revision !== this.dto.sessionRevision) throw new ConflictError('Session load was superseded.', 'STALE_SESSION');
          if (startup.directInstallSource) throw new ConflictError('Add this Git repository through a discovery catalogue to browse it in the web UI.', 'DIRECT_SOURCE_UNSUPPORTED');
          const source = startup.source;
          if (source?.type === 'discovery' && source.discovery.auth?.required) {
            const auth = source.discovery.auth;
            if (auth.oidcDiscoveryUrl && auth.clientId) {
              const identity = { discoveryBaseUrl: source.baseUrl, oidcDiscoveryUrl: auth.oidcDiscoveryUrl, clientId: auth.clientId };
              this.identities.set(JSON.stringify(identity), identity);
            }
          }
          ctx.phase('download');
          const loaded = await loadSession(startup, {
            // A URL selection must acquire its own provenance, not reuse a
            // globally current bundle from a different source.
            forceUpdate: forceUpdate || source?.type === 'url', persist: false,
            signal: ctx.signal, onProgress: ctx.progress, onAuthPrompt: ctx.authPrompt,
            runAuth: (run) => {
              if (revision !== this.dto.sessionRevision || this.signingOut) throw new ConflictError('Session load was superseded.', 'STALE_SESSION');
              return ctx.auth(run);
            },
          });
          checkOperationCancelled(ctx.signal);
          const checks = await runStartupChecks(loaded);
          ctx.phase('commit');
          await withMutation(() => this.exclusive(async () => {
            if (revision !== this.dto.sessionRevision || this.signingOut) throw new ConflictError('Session load was superseded.', 'STALE_SESSION');
            {
              if (loaded.stored) await addSource(loaded.stored, { setActive: true });
              if (source?.type === 'url' || source?.type === 'discovery') await updateConfig((config) => { config.baseUrl = source.baseUrl; });
              if (source && source.type !== 'discovery' && loaded.manifest) await setCurrentBundle(loaded.manifest.version);
            }
            this.session = loaded;
            this.dto = {
              state: 'ready', sessionRevision: revision, loadJobId: id,
              source: source ? { type: source.type, value: safeUrl(source.type === 'directory' ? source.dirPath : source.baseUrl) } : undefined,
              stored: loaded.stored ? sourceDto(loaded.stored) : undefined,
              bundle: loaded.manifest ? { version: loaded.manifest.version, published: loaded.manifest.published } : undefined,
              bundleVersion: effectiveBundleVersion(loaded),
              auth: { required: loaded.auth.required, authenticated: loaded.auth.authenticated, backend: loaded.auth.backend },
              membership: { state: loaded.membership.state, error: loaded.membership.error ? safeText(loaded.membership.error) : undefined },
              catalogue: catalogueDto(buildSessionCatalogue(loaded)), warnings: loaded.warnings.map(safeText),
              startupNotices: checks.notices.map(({ kind, message, actionLabel }) => ({ kind, message: safeText(message), actionLabel })),
            };
            this.publish();
          }));
          return { sessionRevision: revision };
        } catch (error) {
          await this.exclusive(() => {
            if (revision !== this.dto.sessionRevision) return;
            this.dto.state = 'error'; this.dto.error = serialiseError(error).body.error;
            this.dto.catalogue = []; this.dto.membership = { state: 'not-required' }; this.publish();
          });
          throw error;
        }
      });
      this.session = undefined;
      this.dto = { ...this.dto, state: 'loading', sessionRevision: revision, loadJobId: id,
        catalogue: [], warnings: [], startupNotices: [], error: undefined,
        auth: { required: false, authenticated: false }, membership: { state: 'loading' } };
      this.publish();
      if (oldJobId) {
        try { if (this.jobs.get(oldJobId).canCancel) void this.jobs.cancel(oldJobId).catch(() => {}); }
        catch { /* A retained job may already have been evicted. */ }
      }
      return id;
    });
  }
  async candidate(revision: number, skillId: string, installKey: string, scope: InstallScope, repoRoot?: string): Promise<SkillCandidate> {
    const session = this.assertRevision(revision);
    const catalogue = scope === 'repo' && repoRoot ? await buildRepositoryCatalogue(session, repoRoot) : buildSessionCatalogue(session);
    this.assertRevision(revision);
    const candidates = catalogue.filter((entry) => entry.kind === 'skill' && entry.skillId === skillId)
      .flatMap((entry) => entry.kind === 'skill' ? entry.candidates : []).filter((candidate) => candidate.installKey === installKey);
    if (candidates.length !== 1) throw new HttpError(403, 'Select a unique skill from the permitted catalogue.', 'CANDIDATE_REJECTED');
    return candidates[0]!;
  }
  async logout(): Promise<void> {
    await this.exclusive(() => {
      this.assertAuthAvailable(); this.signingOut = true;
      this.dto.sessionRevision++; this.dto.state = 'idle'; this.dto.catalogue = [];
      this.dto.auth.authenticated = false; this.session = undefined; this.publish();
    });
    try {
      // Drain non-abortable work too: it may be doing a silent token refresh.
      await this.jobs.cancelAndWait((job) => ['session-load', 'install-update'].includes(job.kind));
      await withAuthCoordinator(async () => {
        for (const identity of this.identities.values()) await deleteTokens(identity);
      });
    } finally { this.signingOut = false; }
  }
}
