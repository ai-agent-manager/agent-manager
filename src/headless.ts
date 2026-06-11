import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { downloadBundle } from './bundle/downloader.js';
import { extractBundle } from './bundle/extractor.js';
import { importLocalBundle } from './bundle/importer.js';
import { scanBundle } from './bundle/scanner.js';
import { setCurrentBundle } from './bundle/cache.js';
import {
  resolveSkillSource,
  buildSourcePin,
  describeSkillSource,
  isRepoSource,
  isBundleSource,
  type SkillSourcePin,
} from './bundle/skill-source.js';
import { downloadRepoArchive } from './bundle/repo-downloader.js';
import { scanRepoForSkills } from './bundle/repo-scanner.js';
import { downloadArtefact } from './bundle/artefact-downloader.js';
import { scanArtefactForSkills } from './bundle/artefact-scanner.js';
import { ClaudeCodeProvisioner } from './provisioners/ClaudeCodeProvisioner.js';
import { WindsurfProvisioner } from './provisioners/WindsurfProvisioner.js';
import { CopilotProvisioner } from './provisioners/CopilotProvisioner.js';
import { CursorProvisioner } from './provisioners/CursorProvisioner.js';
import type { SkillProvisioner } from './provisioners/SkillProvisioner.js';
import type { SkillInfo } from './bundle/scanner.js';
import type { InstallScope } from './config/scopes.js';

export interface HeadlessConfig {
  tools: string[];
  scope: InstallScope;
  skills: string[];
  bundleVersion?: string;
  /** Expected SHA-256 of the artefact zip — artefact sources only. */
  artefactSha256?: string;
}

export async function parseHeadlessConfig(configPath: string): Promise<HeadlessConfig> {
  const raw = await readFile(configPath, 'utf-8');
  const parsed = parseYaml(raw) as Record<string, unknown>;

  // Define 'tools' (string or string array)
  let tools: string[] = [];
  if (parsed.tools && Array.isArray(parsed.tools)) {
    tools = parsed.tools as string[];
  } else if (parsed.tools && typeof parsed.tools === 'string') {
    tools = [parsed.tools];
  } else {
    throw new Error(
      'ai-skills.yml: "tools" is required (claude-code, windsurf, github-copilot, cursor)'
    );
  }

  if (tools.length === 0) {
    throw new Error('ai-skills.yml: at least one tool must be specified');
  }

  if (!parsed.skills || !Array.isArray(parsed.skills) || parsed.skills.length === 0) {
    throw new Error('ai-skills.yml: "skills" must be a non-empty list of skill names');
  }

  const scope = (parsed.scope as InstallScope) ?? 'repo';

  const bundleVersion =
    parsed['bundle-version'] && typeof parsed['bundle-version'] === 'string'
      ? parsed['bundle-version']
      : undefined;

  let artefactSha256: string | undefined;
  if (parsed['artefact-sha256'] !== undefined) {
    const value = parsed['artefact-sha256'];
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
      throw new Error(
        'ai-skills.yml: "artefact-sha256" must be a 64-character hex SHA-256 string'
      );
    }
    artefactSha256 = value.toLowerCase();
  }

  return {
    tools,
    scope,
    skills: parsed.skills as string[],
    bundleVersion,
    artefactSha256,
  };
}

function createProvisioner(toolId: string, scope: InstallScope, repoRoot: string): SkillProvisioner {
  const options = { scope, repoRoot };
  switch (toolId) {
    case 'claude-code': return new ClaudeCodeProvisioner(options);
    case 'windsurf': return new WindsurfProvisioner(options);
    case 'github-copilot': return new CopilotProvisioner(options);
    case 'cursor': return new CursorProvisioner(options);
    default: throw new Error(`Unknown tool: ${toolId}`);
  }
}

export async function runHeadless(sourceInput: string, configPath: string, forceUpdate: boolean): Promise<void> {
  try {
    await _runHeadless(sourceInput, configPath, forceUpdate);
  } catch (err) {
    console.error(`\n[agentman] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function _runHeadless(sourceInput: string, configPath: string, forceUpdate: boolean): Promise<void> {
  const config = await parseHeadlessConfig(configPath);
  const repoRoot = process.cwd();

  console.log(`\n[agentman] Headless install`);
  console.log(`  Config:  ${configPath}`);
  console.log(`  Tools:   ${config.tools.join(', ')}`);
  console.log(`  Scope:   ${config.scope}`);
  console.log(`  Skills:  ${config.skills.join(', ')}\n`);

  // Resolve source using the multi-source resolver
  const source = await resolveSkillSource(sourceInput);
  console.log(`  Source:  ${describeSkillSource(source)}\n`);

  if (config.artefactSha256 && source.type !== 'artefact') {
    console.warn(
      '[agentman] WARNING: "artefact-sha256" is set but the source is not an artefact — ignoring.'
    );
  }

  let skills: SkillInfo[];
  let bundleVersion: string;
  let sourcePin: SkillSourcePin | undefined;

  if (isRepoSource(source)) {
    // ── Repo source path ──────────────────────────────────────────────────────
    console.log('[agentman] Downloading repository archive...');
    const token = process.env.GITHUB_TOKEN;
    const { extractDir, isNew } = await downloadRepoArchive(source, { forceUpdate, token });

    if (!isNew) {
      console.log('[agentman] Using cached repository archive.');
    }


    console.log('[agentman] Scanning repository for skills...');
    const scanResult = await scanRepoForSkills(extractDir, source);
    skills = scanResult.skills;
    bundleVersion = '';
    sourcePin = buildSourcePin(source);

  } else if (isBundleSource(source)) {
    // ── Bundle source path (existing flow) ────────────────────────────────────
    if (source.baseUrl) {
      console.log(`  Bundle version: ${config.bundleVersion ?? 'latest'}\n`);
      console.log('[agentman] Downloading bundle...');
      const { zipPath } = await downloadBundle(source.baseUrl, config.bundleVersion);
      console.log('[agentman] Extracting bundle...');
      const result = await extractBundle(zipPath);
      bundleVersion = result.manifest.version;
      if (result.isNew) {
        await setCurrentBundle(bundleVersion);
      }
      console.log(`[agentman] Bundle version: ${bundleVersion}`);
      const contents = await scanBundle(result.bundleDir);
      skills = contents.skills;
      sourcePin = buildSourcePin(source, bundleVersion);
    } else {
      console.log('[agentman] Importing local bundle...');
      const result = await importLocalBundle(source.dirPath!);
      bundleVersion = result.manifest.version;
      console.log(`[agentman] Bundle version: ${bundleVersion}`);
      const contents = await scanBundle(result.bundleDir);
      skills = contents.skills;
      sourcePin = buildSourcePin(source, bundleVersion);
    }

  } else {
    // ── Artefact source path ──────────────────────────────────────────────────
    // An explicit hash from ai-skills.yml takes precedence over the published
    // .sha256 sidecar, giving an out-of-band integrity pin.
    const artefactSource = config.artefactSha256
      ? { ...source, sha256: config.artefactSha256 }
      : source;

    console.log('[agentman] Downloading skill artefact...');
    const download = await downloadArtefact(artefactSource, { forceUpdate });

    if (!download.isNew) {
      console.log('[agentman] Using cached artefact.');
    }
    console.log(`[agentman] Artefact version: ${download.version}`);

    console.log('[agentman] Validating artefact contents...');
    const scanResult = await scanArtefactForSkills(download.extractDir, artefactSource);
    skills = scanResult.skills;
    bundleVersion = '';
    // Pin the resolved hash and version so the install record preserves
    // exactly what was acquired.
    sourcePin = buildSourcePin({
      ...artefactSource,
      sha256: download.sha256 ?? artefactSource.sha256,
      version: download.version,
    });
  }

  // ── Shared install logic ──────────────────────────────────────────────────
  const availableSkills = new Map(skills.map(s => [s.dirName, s]));

  const toInstall = [];
  const notFound = [];

  for (const skillName of config.skills) {
    const skill = availableSkills.get(skillName);
    if (skill) {
      toInstall.push(skill);
    } else {
      notFound.push(skillName);
    }
  }

  if (notFound.length > 0) {
    console.warn(`\n[agentman] WARNING: The following skills were not found:`);
    for (const name of notFound) {
      console.warn(`  - ${name}`);
    }
    console.warn(`\n  Available skills: ${[...availableSkills.keys()].join(', ')}`);
  }

  if (toInstall.length === 0) {
    console.error('\n[agentman] ERROR: No valid skills to install. Exiting.');
    process.exit(1);
  }

  // Install for each tool in sequence
  let hasErrors = false;

  for (const toolId of config.tools) {
    console.log(`\n[agentman] Installing ${toInstall.length} skill(s) for ${toolId}...`);
    const provisioner = createProvisioner(toolId, config.scope, repoRoot);
    const result = await provisioner.install(toInstall, bundleVersion, sourcePin);

    if (result.installed.length > 0) {
      console.log(`[agentman] Installed (${toolId}):`);
      for (const item of result.installed) {
        console.log(`  ✓ ${item.name} (${item.method}) → ${item.path}`);
      }
    }

    if (result.errors.length > 0) {
      console.error(`[agentman] Errors (${toolId}):`);
      for (const err of result.errors) {
        console.error(`  ✗ ${err.name}: ${err.error}`);
      }
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(`\n[agentman] Done.\n`);
}
