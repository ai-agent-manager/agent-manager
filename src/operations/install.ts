import { canonicaliseContentRoot, downloadBundle } from '../bundle/downloader.js';
import { extractBundle } from '../bundle/extractor.js';
import { importLocalBundle } from '../bundle/importer.js';
import { scanBundle } from '../bundle/scanner.js';
import path from 'node:path';
import { setCurrentBundle } from '../bundle/cache.js';
import {
  buildSourcePin,
  bundleSourceKey,
  isRepoSource,
  isBundleSource,
  resolveSkillSource,
  deriveInstallNamespace,
  buildLinkName,
  type SkillSource,
  type SkillSourcePin,
} from '../bundle/skill-source.js';
import { downloadRepoArchive } from '../bundle/repo-downloader.js';
import { scanRepoForSkills } from '../bundle/repo-scanner.js';
import { downloadArtefact } from '../bundle/artefact-downloader.js';
import { scanArtefactForSkills } from '../bundle/artefact-scanner.js';
import type { SkillInfo, AgentInfo } from '../bundle/scanner.js';
import type { InstallScope } from '../config/scopes.js';
import type { AgentDependencies } from '../bundle/manifest.js';
import type { ExistingSkillPolicy, InstallResult } from '../provisioners/types.js';
import { createSkillProvisioner } from '../provisioners/registry.js';
import { createAgentProvisioner } from '../provisioners/agent-registry.js';
import { findRepoRoot } from '../lib/repo.js';
import { readDeclaredSkillName } from '../lib/frontmatter.js';
import { getValidBearerToken, type AuthSession } from '../auth/index.js';

async function resolveInstallBearer(
  authSession?: AuthSession,
  bearerToken?: string,
): Promise<string | undefined> {
  if (authSession) {
    return getValidBearerToken(authSession.discoveryBaseUrl, authSession.auth);
  }
  return bearerToken;
}

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
  /** When set, refresh a bearer before authenticated bundle downloads. */
  authSession?: AuthSession;
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
    authSession,
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
    const bearer = await resolveInstallBearer(authSession, bearerToken);
    const { zipPath } = await downloadBundle(source.baseUrl, requestedVersion, bearer, sourceKey);
    const extracted = await extractBundle(
      zipPath,
      sourceKey ? { sourceKey, contentRoot: source.baseUrl } : undefined,
    );
    bundleVersion = extracted.manifest.version;
    // Only the version-keyed cache backs the `current` symlink; pointing it at a
    // source-scoped extract would dangle. See resolver.ts and #50.
    if (extracted.isNew && !sourceKey) await setCurrentBundle(bundleVersion);
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
  /** Defaults to `abort`: never replace a skill agentman did not install. */
  existingSkills?: ExistingSkillPolicy;
}

export async function installResolvedSkills(opts: InstallResolvedSkillsOpts): Promise<InstallResult> {
  const { skills, toolId, scope, bundleVersion, existingSkills } = opts;
  const repoRoot = await resolveRepoRoot(scope, opts.repoRoot);
  const provisioner = createSkillProvisioner(toolId, scope, repoRoot);
  return provisioner.install(skills, bundleVersion ?? '', undefined, { existing: existingSkills });
}

/**
 * Install already-acquired harness agents (e.g. resolved from a discovery
 * document) for one tool.
 */
export interface InstallResolvedAgentsOpts {
  agents: AgentInfo[];
  toolId: string;
  scope: InstallScope;
  repoRoot?: string;
  bundleVersion?: string;
  /** Bundle URL for resolving "self" dependencies */
  bundleUrl?: string;
  /** Auth session for authenticated bundle downloads */
  authSession?: AuthSession;
  /**
   * What to do when a dependency name is already taken by a skill agentman
   * did not install. Defaults to `keep` (reuse it, with a warning).
   */
  existingSkills?: ExistingSkillPolicy;
}

/**
 * Install agents, first installing any skills they depend on. Every declared
 * dependency is mandatory: if any cannot be found in the dependency source, that
 * agent and all of its dependencies are left uninstalled. Other agents in the
 * same call are unaffected.
 */
export async function installResolvedAgents(
  opts: InstallResolvedAgentsOpts,
): Promise<InstallResult> {
  const { agents, toolId, scope, bundleVersion } = opts;
  const repoRoot = await resolveRepoRoot(scope, opts.repoRoot);
  const provisioner = createAgentProvisioner(toolId, scope, repoRoot);
  const result: Required<InstallResult> = { installed: [], errors: [], warnings: [] };
  const ready: AgentInfo[] = [];

  for (const agent of agents) {
    if (!agent.dependencies) {
      ready.push(agent);
      continue;
    }
    try {
      const depResult = await installAgentDependencies(agent, agent.dependencies, provisioner, {
        ...opts,
        repoRoot,
      });
      result.installed.push(...depResult.installed);
      result.warnings.push(...(depResult.warnings ?? []));
      ready.push(agent);
    } catch (err) {
      result.errors.push({
        name: agent.dirName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (ready.length > 0) {
    const agentResult = await provisioner.installAgents(ready, bundleVersion ?? '');
    result.installed.push(...agentResult.installed);
    result.errors.push(...agentResult.errors);
  }

  return result.warnings.length > 0
    ? result
    : { installed: result.installed, errors: result.errors };
}

/**
 * Names that must be safe to join onto a skills directory: a manifest could
 * otherwise point a dependency at `../something` and have it backed up or replaced.
 */
const SKILL_ID_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/**
 * Resolve and install the skills one agent depends on. Throws, having installed
 * nothing, if any dependency is invalid, unavailable, or (under the `abort`
 * policy) blocked by an unmanaged skill of the same name.
 */
async function installAgentDependencies(
  agent: AgentInfo,
  dependencies: AgentDependencies,
  provisioner: ReturnType<typeof createAgentProvisioner>,
  opts: InstallResolvedAgentsOpts,
): Promise<InstallResult> {
  const policy = opts.existingSkills ?? 'keep';

  const invalid = dependencies.skills.filter((s) => !SKILL_ID_PATTERN.test(s));
  if (invalid.length > 0) {
    throw new Error(`Invalid dependency skill name(s): ${invalid.map((s) => JSON.stringify(s)).join(', ')}`);
  }

  const { missing, unmanaged, clashes } = await provisioner.checkDependencies(dependencies);
  const warnings: string[] = [];

  if (unmanaged.length > 0 && policy === 'abort') {
    throw new Error(
      `Skill(s) already exist but were not installed by agentman: ` +
      `${unmanaged.map((name) => describeClash(name, clashes[name])).join(', ')}. ` +
      `Not installing to avoid replacing or duplicating them.`,
    );
  }
  if (policy === 'keep') {
    for (const name of unmanaged) {
      warnings.push(
        `Using existing "${describeClash(name, clashes[name])}" for ${agent.dirName}; ` +
        `it was not installed by agentman and may differ from the bundled version.`,
      );
    }
  }

  const needed = policy === 'backup' ? [...missing, ...unmanaged] : missing;
  if (needed.length === 0) return { installed: [], errors: [], warnings };

  const depBundleUrl = dependencies.bundle === 'self' ? opts.bundleUrl : dependencies.bundle;
  const source = await loadDependencySource(agent, depBundleUrl, opts);
  const available = new Map(source.skills.map((s) => [s.dirName, s]));

  const unresolved = needed.filter((name) => !available.has(name));
  if (unresolved.length > 0) {
    const names = [...available.keys()];
    const described = unresolved.map((name) => {
      const suggestion = closestMatch(name, names);
      return suggestion ? `${name} (did you mean "${suggestion}"?)` : name;
    });
    throw new Error(
      `Required skill(s) not found in ${source.label}: ${described.join(', ')}. ` +
      `Nothing was installed for this agent.`,
    );
  }

  const skillProvisioner = createSkillProvisioner(opts.toolId, opts.scope, opts.repoRoot);
  const skillResult = await skillProvisioner.install(
    needed.map((name) => available.get(name)!),
    source.version,
    source.sourcePin,
    { existing: policy === 'backup' ? 'backup' : 'abort' },
  );
  warnings.push(...(skillResult.warnings ?? []));

  if (skillResult.errors.length > 0) {
    throw new Error(
      `Failed to install dependencies: ${skillResult.errors.map((e) => `${e.name}: ${e.error}`).join('; ')}`,
    );
  }

  const { missing: stillMissing } = await provisioner.checkDependencies(dependencies);
  if (stillMissing.length > 0) {
    throw new Error(`Dependencies still missing after install: ${stillMissing.join(', ')}`);
  }

  return { installed: skillResult.installed, errors: [], warnings };
}

interface DependencySource {
  skills: SkillInfo[];
  version: string;
  sourcePin?: SkillSourcePin;
  /** Human-readable description for error messages. */
  label: string;
}

async function loadDependencySource(
  agent: AgentInfo,
  depBundleUrl: string | undefined,
  opts: InstallResolvedAgentsOpts,
): Promise<DependencySource> {
  const { bundleVersion, authSession } = opts;

  if (!depBundleUrl) {
    // Local directory sources: dependencies sit alongside the agent.
    const dir = path.dirname(agent.dirPath);
    const contents = await scanBundle(dir);
    return { skills: contents.skills, version: bundleVersion ?? 'local', label: `local directory ${dir}` };
  }

  let source;
  try {
    source = await resolveSkillSource(depBundleUrl);
  } catch (err) {
    throw new Error(`Failed to resolve bundle URL: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isBundleSource(source)) {
    throw new Error(`Cannot install dependencies: expected bundle source, got ${source.type}`);
  }

  if (source.baseUrl) {
    // Use the agent's bundleVersion so skill versions match the agent.
    const bearer = await resolveInstallBearer(authSession);
    const { zipPath } = await downloadBundle(source.baseUrl, bundleVersion, bearer);
    const extracted = await extractBundle(zipPath);
    const contents = await scanBundle(extracted.bundleDir, extracted.manifest.agents);
    const version = extracted.manifest.version;
    return {
      skills: contents.skills,
      version,
      sourcePin: {
        sourceType: 'bundle',
        installLayout: 'flat',
        bundleBaseUrl: source.baseUrl,
        bundleSourceName: source.sourceName,
        bundleVersion: version,
        bundleAddressing: 'content-root',
      },
      label: `bundle ${source.baseUrl}`,
    };
  }

  if (source.dirPath) {
    const contents = await scanBundle(source.dirPath);
    const version = bundleVersion ?? 'local';
    return {
      skills: contents.skills,
      version,
      sourcePin: { sourceType: 'bundle', installLayout: 'flat', bundleVersion: version },
      label: `directory ${source.dirPath}`,
    };
  }

  throw new Error('Bundle source has neither baseUrl nor dirPath');
}

/** Closest candidate by case-insensitive edit distance, if close enough to be a likely typo. */
function closestMatch(name: string, candidates: string[]): string | undefined {
  const target = name.toLowerCase();
  let best: string | undefined;
  // Never suggest a name that shares nothing with the original (e.g. "x" → "a").
  let bestDistance = Math.min(Math.max(2, Math.floor(target.length / 3)) + 1, target.length);
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

/** "idea-forge", or "idea-forge (in my-ideas/)" when the clash is a differently named folder. */
function describeClash(name: string, folders: string[] = []): string {
  const others = folders.filter((folder) => folder !== name);
  return others.length > 0 ? `${name} (in ${others.map((f) => `${f}/`).join(', ')})` : name;
}

/**
 * Skills, per tool, that agentman did not install and that an install of
 * `entry` would replace or duplicate (same folder, or same declared skill
 * name). For agents these are its dependencies; for skills, the skill itself.
 * Used by the TUI to ask the user before installing.
 */
export async function findExistingSkillConflicts(opts: {
  entry: { kind: 'agent'; agent: AgentInfo } | { kind: 'skill'; skill: SkillInfo };
  toolIds: string[];
  scope: InstallScope;
  repoRoot?: string;
}): Promise<Array<{ toolId: string; names: string[] }>> {
  const repoRoot = await resolveRepoRoot(opts.scope, opts.repoRoot);
  const conflicts: Array<{ toolId: string; names: string[] }> = [];

  for (const toolId of opts.toolIds) {
    let names: string[];
    if (opts.entry.kind === 'agent') {
      const deps = opts.entry.agent.dependencies;
      if (!deps) continue;
      const check = await createAgentProvisioner(toolId, opts.scope, repoRoot).checkDependencies(deps);
      names = check.unmanaged.map((name) => describeClash(name, check.clashes[name]));
    } else {
      const { skill } = opts.entry;
      const namespace = skill.sourcePin ? deriveInstallNamespace(skill.sourcePin) : null;
      const linkName = namespace ? buildLinkName(namespace, skill.dirName) : skill.dirName;
      const name = (await readDeclaredSkillName(skill.skillMdPath)) ?? skill.dirName;
      const clashes = await createSkillProvisioner(toolId, opts.scope, repoRoot)
        .findUnmanagedClashes([{ linkName, name }]);
      names = clashes.has(linkName) ? [describeClash(name, clashes.get(linkName))] : [];
    }
    if (names.length > 0) conflicts.push({ toolId, names });
  }

  return conflicts;
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
    authSession?: AuthSession;
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
    const bearer = await resolveInstallBearer(opts.authSession, opts.bearerToken);
    const download = await downloadArtefact(artefactSource, {
      forceUpdate: opts.forceUpdate,
      bearerToken: bearer,
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
    const bearer = await resolveInstallBearer(opts.authSession, opts.bearerToken);
    const { zipPath } = await downloadBundle(
      source.baseUrl,
      opts.bundleVersion,
      bearer,
      sourceKey,
    );
    const extracted = await extractBundle(
      zipPath,
      sourceKey ? { sourceKey, contentRoot: source.baseUrl } : undefined,
    );
    const bundleVersion = extracted.manifest.version;
    if (extracted.isNew && !sourceKey) await setCurrentBundle(bundleVersion);
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
