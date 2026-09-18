// Browser contract: type-only imports from pure modules; no server objects.
import type { InstallScope } from '../config/scopes.js';
import type { SourceType, SourceStatus } from '../discovery/types.js';

export interface ErrorDto {
  name: string;
  message: string;
  category: string;
  code?: string;
  matches?: InstalledRecordDto[];
  baseUrl?: string;
  status?: number;
  expected?: string;
  actual?: string;
  url?: string;
  errors?: string[];
}
export interface StoredSourceDto { kind: 'discovery' | 'repo' | 'directory'; value: string }
export interface CandidateDto {
  installKey: string;
  sourceName: string;
  sourceType: SourceType;
  sourceStatus?: SourceStatus;
  version?: string;
}
export interface CatalogueEntryDto {
  kind: 'skill';
  skillId: string;
  displayName: string;
  description: string;
  projectNames?: string[];
  candidates: CandidateDto[];
}
export interface AuthDto { required: boolean; authenticated: boolean; backend?: 'keychain' | 'filesystem'; discoveryBaseUrl?: string }
export interface SessionDto {
  state: 'idle' | 'loading' | 'ready' | 'error';
  sessionRevision: number;
  source?: { type: 'url' | 'directory' | 'discovery'; value: string };
  stored?: StoredSourceDto;
  bundle?: { version: string; published: string };
  auth: AuthDto;
  membership: { state: 'not-required' | 'loading' | 'ready' | 'error'; error?: string };
  catalogue: CatalogueEntryDto[];
  bundleVersion?: string;
  warnings: string[];
  error?: ErrorDto;
  startupNotices: Array<{ kind: 'app' | 'bundle'; message: string; actionLabel: string }>;
  loadJobId?: string;
}
export interface InstalledRecordDto {
  installKey: string; skillId: string; toolId: string; scope: InstallScope;
  repoRoot?: string; version: string; installedAt: string;
  method: 'symlink' | 'copy'; linkName: string;
  source?: { type: 'repo' | 'bundle' | 'artefact'; value?: string };
}
export interface InstallResultDto {
  installed: Array<{ name: string; method: 'symlink' | 'copy'; path: string }>;
  errors: Array<{ name: string; error: string }>;
}
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobPhase = 'queued' | 'resolving' | 'auth' | 'download' | 'commit' | 'complete';
export type JobResult = { failures: string[]; superseded?: boolean } | { success: true } | { result: InstallResultDto } | { sessionRevision: number } | Record<string, never>;
export interface JobDto {
  id: string; kind: string; state: JobState; phase: JobPhase; canCancel: boolean;
  progress: string; authorizeUrl?: string; result?: JobResult; error?: ErrorDto;
}
export interface SnapshotDto { session: SessionDto; jobs: JobDto[] }
export interface ContextDto {
  appVersion: string; platform: string; cwd: string; repoRoot: string | null; repoName: string | null;
  tools: Array<{ id: string; name: string; note?: string; repoNote?: string }>;
}
export interface InstallRequest {
  sessionRevision: number; skillId: string; installKey: string; scope: InstallScope;
  repoRoot?: string; toolIds: string[];
}
export interface SourcesDto { sources: StoredSourceDto[]; active: StoredSourceDto | null }
export interface SettingsDto {
  startupUpdateChecksDisabled: boolean;
  telemetryDisabled: boolean;
  uiTheme: 'system' | 'light' | 'dark';
  envOverrides: { startupUpdateChecksDisabled: boolean; telemetryDisabled: boolean };
}

export interface BundleSourceDto { type: 'url' | 'directory'; value: string; name?: string }
export interface BundleDto {
  bundleId?: string; removalId?: string; canRemove?: boolean; removalReason?: string; version: string; published: string;
  source?: BundleSourceDto; cacheKind?: 'flat' | 'named'; isCurrent: boolean;
  canSelect: boolean; reason?: string; hasSkill?: boolean;
}
export interface BundlesDto { cached: BundleDto[]; current: string | null; canBrowseRemote: boolean; reason?: string }
export interface RemoteBundleDto { bundleId: string; version: string; published: string; source: BundleSourceDto }
export interface RemoteBundlesDto { bundles: RemoteBundleDto[]; sessionRevision: number }
export interface SkillVersionsDto { bundles: BundleDto[]; supported: boolean; reason?: string }
