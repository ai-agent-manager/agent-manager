import { canonicaliseContentRoot, downloadBundle } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { importLocalBundle } from '../bundle/importer.js';
import { scanBundle } from '../bundle/scanner.js';
import { setCurrentBundle } from '../bundle/cache.js';
import {
  buildSourcePin,
  bundleSourceKey,
  isRepoSource,
  resolveSkillSource,
  type SkillSource,
  type SkillSourcePin,
} from '../bundle/skill-source.js';
import { downloadRepoArchive } from '../bundle/repo-downloader.js';
import { scanRepoForSkills } from '../bundle/repo-scanner.js';
import { downloadArtefact } from '../bundle/artefact-downloader.js';
import { scanArtefactForSkills } from '../bundle/artefact-scanner.js';
import type { SkillInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import type { InstallResult } from '../provisioners/types.js';
import { createSkillProvisioner } from '../provisioners/registry.js';
import { findRepoRoot } from '../lib/repo.js';

export interface InstallFromRepoOpts {
  repoUrl: string;
  ref?: string;
  skillNames?: string[];
  scope: InstallScope;
  toolId: string;
  repoRoot?: string;
  forceUpdate?: boolean;
}

export interface InstallFromArtefactOpts {
  artefactUrl: string;
  sha256?: string;
  scope: InstallScope;
  toolId: string;
  repoRoot?: string;
  forceUpdate?: boolean;
  /** Bearer token for artefacts hosted on an authenticated origin. */
  bearerToken?: string;
}

export interface InstallFromBundleOpts {
  /** Content root, or a local bundle directory path. */
  bundleUrl: string;
  /**
   * Logical name of the declared discovery source, when the install comes from
   * one. Its presence is what makes the install source-namespaced.
   */
  sourceName?: string;
  bundleVersion?: string;
  skillNames?: string[];
  scope: InstallScope;
  toolId: string;
  repoRoot?: string;
  forceUpdate?: boolean;
  /** Bearer token for bundles hosted on an authenticated origin. */
  bearerToken?: string;
}

export interface InstallOperationResult {
  toolId: string;
  result: InstallResult;
  sourcePin: SkillSourcePin;
  bundleVersion: string;
}

export interface AcquireResult {
  skills: SkillInfo[];
  bundleVersion: string;
  sourcePin: SkillSourcePin;
}

/**
 * Download and scan a repo source, then install the requested skills
 * for one tool.
 */
export async function installFromRepo(opts: InstallFromRepoOpts): Promise<InstallOperationResult> {
  const { repoUrl, ref, skillNames, scope, toolId, forceUpdate } = opts;

  const source = await resolveRepoSource(repoUrl, ref);
  const token = process.env.GITHUB_TOKEN;
  const { extractDir } = await downloadRepoArchive(source, { forceUpdate, token });
  const scanResult = await scanRepoForSkills(extractDir, source);

  const available = new Map(scanResult.skills.map((s) => [s.dirName, s]));
  const toInstall = selectSkills(available, skillNames);
  const sourcePin = buildSourcePin(source);
  const repoRoot = await resolveRepoRoot(scope, opts.repoRoot);
  const provisioner = createSkillProvisioner(toolId, scope, repoRoot);
  const result = await provisioner.install(toInstall, '', sourcePin);

  return { toolId, result, sourcePin, bundleVersion: '' };
}

/**
 * Download and install a single-skill artefact zip for one tool.
 */
export async function installFromArtefact(opts: InstallFromArtefactOpts): Promise<InstallOperationResult> {
  const { artefactUrl, sha256, scope, toolId, forceUpdate } = opts;

  const source = await resolveSkillSourceStrict(artefactUrl, 'artefact');
  const artefactSource = sha256 ? { ...source, sha256 } : source;
  const download = await downloadArtefact(artefactSource, {
    forceUpdate,
    bearerToken: opts.bearerToken,
  });
  const scanResult = await scanArtefactForSkills(download.extractDir, artefactSource);

  const sourcePin = buildSourcePin({
    ...artefactSource,
    sha256: download.sha256 ?? artefactSource.sha256,
    version: download.version,
  });
  const repoRoot = await resolveRepoRoot(scope, opts.repoRoot);
  const provisioner = createSkillProvisioner(toolId, scope, repoRoot);
  const result = await provisioner.install(scanResult.skills, '', sourcePin);

  return { toolId, result, sourcePin, bundleVersion: '' };
}

/**
 * Download and install from a legacy bundle URL or local directory for one tool.
 */
export async function installFromBundle(opts: InstallFromBundleOpts): Promise<InstallOperationResult> {
  const {
    bundleUrl,
    sourceName,
    bundleVersion: requestedVersion,
    skillNames,
    scope,
    toolId,
    bearerToken,
  } = opts;

  // A declared discovery source is already known to be an HTTP bundle, so its
  // URL is used as given. Re-sniffing it would misclassify a content root that
  // happens to sit on a git host.
  const source: Extract<SkillSource, { type: 'bundle' }> = sourceName
    ? {
        type: 'bundle',
        baseUrl: canonicaliseContentRoot(bundleUrl),
        sourceName,
        installLayout: 'namespaced',
      }
    : await resolveSkillSourceStrict(bundleUrl, 'bundle');

  let bundleVersion: string;
  let skills: SkillInfo[];

  if (source.baseUrl) {
    const sourceKey = sourceName ? bundleSourceKey(sourceName) : undefined;
    const { zipPath } = await downloadBundle(source.baseUrl, requestedVersion, bearerToken, sourceKey);
    const extracted = await extractBundle(zipPath, sourceKey ? { sourceKey } : undefined);
    bundleVersion = extracted.manifest.version;
    if (extracted.isNew) await setCurrentBundle(bundleVersion);
    const contents = await scanBundle(extracted.bundleDir, extracted.manifest.agents);
    skills = contents.skills;
  } else {
    const imported = await importLocalBundle(source.dirPath!);
    bundleVersion = imported.manifest.version;
    const contents = await scanBundle(imported.bundleDir, imported.manifest.agents);
    skills = contents.skills;
  }

  const available = new Map(skills.map((s) => [s.dirName, s]));
  const toInstall = selectSkills(available, skillNames);
  const sourcePin = buildSourcePin(source, bundleVersion);
  const repoRoot = await resolveRepoRoot(scope, opts.repoRoot);
  const provisioner = createSkillProvisioner(toolId, scope, repoRoot);
  const result = await provisioner.install(toInstall, bundleVersion, sourcePin);

  return { toolId, result, sourcePin, bundleVersion };
}

/**
 * Install already-acquired skills (e.g. resolved from a discovery document)
 * for one tool. Each skill's own sourcePin governs its install identity.
 */
export interface InstallResolvedSkillsOpts {
  skills: SkillInfo[];
  toolId: string;
  scope: InstallScope;
  repoRoot?: string;
  bundleVersion?: string;
}

export async function installResolvedSkills(opts: InstallResolvedSkillsOpts): Promise<InstallResult> {
  const { skills, toolId, scope, bundleVersion } = opts;
  const repoRoot = await resolveRepoRoot(scope, opts.repoRoot);
  const provisioner = createSkillProvisioner(toolId, scope, repoRoot);
  return provisioner.install(skills, bundleVersion ?? '');
}

/**
 * Acquire a SkillSource and return the scanned skills + version + pin,
 * without installing. Used by the TUI to let the user inspect a source
 * before confirming.
 */
export async function acquireSource(
  source: SkillSource,
  opts: {
    sha256?: string;
    bundleVersion?: string;
    forceUpdate?: boolean;
    bearerToken?: string;
  } = {},
): Promise<AcquireResult> {
  if (isRepoSource(source)) {
    const token = process.env.GITHUB_TOKEN;
    const { extractDir } = await downloadRepoArchive(source, { forceUpdate: opts.forceUpdate, token });
    const scanResult = await scanRepoForSkills(extractDir, source);
    return {
      skills: scanResult.skills,
      bundleVersion: '',
      sourcePin: buildSourcePin(source),
    };
  }

  if (source.type === 'artefact') {
    const artefactSource = opts.sha256 ? { ...source, sha256: opts.sha256 } : source;
    const download = await downloadArtefact(artefactSource, {
      forceUpdate: opts.forceUpdate,
      bearerToken: opts.bearerToken,
    });
    const scanResult = await scanArtefactForSkills(download.extractDir, artefactSource);
    return {
      skills: scanResult.skills,
      bundleVersion: '',
      sourcePin: buildSourcePin({
        ...artefactSource,
        sha256: download.sha256 ?? artefactSource.sha256,
        version: download.version,
      }),
    };
  }

  if (source.baseUrl) {
    const sourceKey = source.sourceName ? bundleSourceKey(source.sourceName) : undefined;
    const { zipPath } = await downloadBundle(
      source.baseUrl,
      opts.bundleVersion,
      opts.bearerToken,
      sourceKey,
    );
    const extracted = await extractBundle(zipPath, sourceKey ? { sourceKey } : undefined);
    const bundleVersion = extracted.manifest.version;
    if (extracted.isNew) await setCurrentBundle(bundleVersion);
    const contents = await scanBundle(extracted.bundleDir, extracted.manifest.agents);
    return {
      skills: contents.skills,
      bundleVersion,
      sourcePin: buildSourcePin(source, bundleVersion),
    };
  }

  const imported = await importLocalBundle(source.dirPath!);
  const bundleVersion = imported.manifest.version;
  const contents = await scanBundle(imported.bundleDir, imported.manifest.agents);
  return {
    skills: contents.skills,
    bundleVersion,
    sourcePin: buildSourcePin(source, bundleVersion),
  };
}

async function resolveRepoSource(repoUrl: string, ref?: string) {
  const source = await resolveSkillSource(ref ? `${repoUrl}/tree/${ref}` : repoUrl);
  if (!isRepoSource(source)) throw new Error(`Not a repo URL: ${repoUrl}`);
  return source;
}

async function resolveSkillSourceStrict<T extends SkillSource['type']>(
  input: string,
  expected: T,
): Promise<Extract<SkillSource, { type: T }>> {
  const source = await resolveSkillSource(input);
  if (source.type !== expected) {
    throw new Error(`Not a ${expected} URL: ${input}`);
  }
  return source as Extract<SkillSource, { type: T }>;
}

function selectSkills(available: Map<string, SkillInfo>, names?: string[]): SkillInfo[] {
  if (!names || names.length === 0) return [...available.values()];

  const notFound = names.filter((n) => !available.has(n));
  if (notFound.length > 0) {
    throw new Error(
      `Skill(s) not found: ${notFound.join(', ')}\n` +
        `  Available: ${[...available.keys()].join(', ')}`,
    );
  }

  return names.map((n) => available.get(n)!);
}

async function resolveRepoRoot(scope: InstallScope, repoRoot?: string): Promise<string | undefined> {
  if (scope !== 'repo') return undefined;
  if (repoRoot) return repoRoot;
  const root = await findRepoRoot();
  if (!root) {
    throw new Error(
      `Repo scope requires being inside a git repository.\n` +
        `  Run agentman from inside a git repo, or choose the local scope.`,
    );
  }
  return root;
}
