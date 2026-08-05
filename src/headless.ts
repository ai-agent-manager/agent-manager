import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { downloadBundle } from './bundle/downloader.js';
import { extractBundle } from './bundle/extractor.js';
import { importLocalBundle } from './bundle/importer.js';
import { scanBundle, type SkillInfo } from './bundle/scanner.js';
import { setCurrentBundle } from './bundle/cache.js';
import { resolveSource } from './bundle/source.js';
import { buildPinForDirectorySource, deriveSkillInstallKey, type SkillSourcePin } from './bundle/skill-source.js';

// Re-exported for backward compatibility with existing importers/tests.
export { buildPinForDirectorySource } from './bundle/skill-source.js';
import { resolveDiscoverySkills } from './discovery/index.js';
import { authenticate, type AuthSession } from './auth/index.js';
import {
  isProjectsExclusiveSource,
  listProjects,
  resolveApiBaseUrl,
  type ApiAuth,
} from './api/index.js';
import {
  partitionSkillsByScope,
  resolveCatalogueScope,
} from './catalogue-scope/index.js';
import { createSkillProvisioner, formatSupportedSkillToolIds } from './provisioners/registry.js';
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
  const raw = await readFile(configPath, "utf-8");
  const parsed = parseYaml(raw) as Record<string, unknown>;

  // Define 'tools' (string or string array)
  let tools: string[] = [];
  if (parsed.tools && Array.isArray(parsed.tools)) {
    tools = parsed.tools as string[];
  } else if (parsed.tools && typeof parsed.tools === "string") {
    tools = [parsed.tools];
  } else {
    throw new Error(`ai-skills.yml: "tools" is required (${formatSupportedSkillToolIds()})`);
  }

  if (tools.length === 0) {
    throw new Error("ai-skills.yml: at least one tool must be specified");
  }

  if (!parsed.skills || !Array.isArray(parsed.skills) || parsed.skills.length === 0) {
    throw new Error('ai-skills.yml: "skills" must be a non-empty list of skill names');
  }

  const scope = (parsed.scope as InstallScope) ?? "repo";

  const bundleVersion =
    parsed["bundle-version"] && typeof parsed["bundle-version"] === "string" ? parsed["bundle-version"] : undefined;

  let artefactSha256: string | undefined;
  if (parsed["artefact-sha256"] !== undefined) {
    const value = String(parsed["artefact-sha256"]);
    if (!/^[0-9a-f]{64}$/i.test(value)) {
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

// TODO(#39): wire _forceUpdate into the headless acquisition path so `agentman <url> --update`
// bypasses the cached bundle in extractBundle (src/bundle/extractor.ts:33-37).
// See https://github.com/ai-agent-manager/agent-manager/issues/39
export async function runHeadless(sourceInput: string, configPath: string, _forceUpdate: boolean): Promise<void> {
  const config = await parseHeadlessConfig(configPath);
  const repoRoot = process.cwd();

  console.log(`\n[agentman] Headless install`);
  console.log(`  Config:  ${configPath}`);
  console.log(`  Tools:   ${config.tools.join(", ")}`);
  console.log(`  Scope:   ${config.scope}`);
  console.log(`  Skills:  ${config.skills.join(", ")}\n`);
  console.log(`  Bundle version: ${config.bundleVersion ?? "latest"}\n`);

  // Acquire skills
  const source = await resolveSource(sourceInput);
  let allSkills: SkillInfo[];
  let bundleVersion: string;
  let sourcePin: SkillSourcePin | undefined;

  if (source.type === "discovery") {
    // sourcePin stays undefined for discovery installs — added in the namespaced-layout follow-up.
    console.log("[agentman] Discovery document found");

    let accessToken: string | undefined;
    let authSession: AuthSession | undefined;

    if (source.discovery.auth?.required) {
      console.log('[agentman] Authenticating...');
      const authResult = await authenticate(
        source.baseUrl,
        source.discovery.auth,
        (url) => {
          console.error(`\n[agentman] ERROR: Authentication required. Visit this URL to authorise:`);
          console.error(`  ${url}\n`);
          console.error(`  Or set AGENTMAN_ACCESS_TOKEN environment variable.\n`);
          process.exit(1);
        },
      );
      if (authResult.fromEnv) {
        accessToken = authResult.bearerToken;
        console.log('[agentman] Using access token from AGENTMAN_ACCESS_TOKEN');
      } else {
        authSession = {
          discoveryBaseUrl: source.baseUrl,
          auth: source.discovery.auth,
        };
      }
    }

    console.log(`[agentman] Resolving ${source.discovery.sources.length} source(s) from discovery document...`);
    const result = await resolveDiscoverySkills(
      source.discovery,
      accessToken,
      (msg) => console.log(`[agentman] ${msg}`),
      {
        artefactSha256: config.artefactSha256,
        ...(authSession ? { authSession } : {}),
      },
    );

    for (const { source: failedSource, error, isIntegrity } of result.errors) {
      if (isIntegrity) {
        console.error(`[agentman] ERROR: Integrity check failed for '${failedSource.name}': ${error}`);
      } else {
        console.warn(`[agentman] WARNING: Failed to resolve source '${failedSource.name}': ${error}`);
      }
    }

    const hasIntegrityError = result.errors.some((e) => e.isIntegrity);
    if (hasIntegrityError) {
      process.exit(1);
    }

    allSkills = result.skills;
    bundleVersion = result.bundleVersion ?? "discovery";

    if (isProjectsExclusiveSource(source.discovery.projects)) {
      const apiBaseUrl = resolveApiBaseUrl(source.discovery.api?.baseUrl);
      if (!apiBaseUrl) {
        console.error(
          '\n[agentman] ERROR: projects.exclusiveSource is enabled but no API base URL is configured.\n' +
            '  Set api.baseUrl in the discovery document or API_BASE_URL.\n',
        );
        process.exit(1);
      }

      let apiAuth: ApiAuth | undefined;
      if (accessToken) {
        apiAuth = { bearerToken: accessToken };
      } else if (authSession) {
        apiAuth = authSession;
      } else {
        console.error(
          '\n[agentman] ERROR: projects.exclusiveSource requires authentication to resolve project memberships.\n' +
            '  Set AGENTMAN_ACCESS_TOKEN or complete interactive login first.\n',
        );
        process.exit(1);
      }

      console.log('[agentman] Loading project memberships (exclusiveSource)...');
      const membershipProjects = await listProjects(apiBaseUrl, apiAuth);
      const scope = resolveCatalogueScope({
        exclusiveSource: true,
        membershipProjects,
      });
      const { permitted, excluded } = partitionSkillsByScope(allSkills, scope);
      allSkills = permitted;
      if (excluded.length > 0) {
        console.log(
          `[agentman] Exclusive catalogue: ${permitted.length} skill(s) permitted by project membership ` +
            `(${excluded.length} excluded)`,
        );
      }
    }
  } else {
    let bundleDir: string;

    if (source.type === "url") {
      // sourcePin stays undefined here — this branch is dead code (resolveSource never returns 'url').
      console.log("[agentman] Downloading bundle...");
      const { zipPath } = await downloadBundle(source.baseUrl, config.bundleVersion);
      console.log("[agentman] Extracting bundle...");
      const result = await extractBundle(zipPath);
      bundleDir = result.bundleDir;
      bundleVersion = result.manifest.version;
      if (result.isNew) {
        await setCurrentBundle(bundleVersion);
      }
    } else {
      console.log("[agentman] Importing local bundle...");
      const result = await importLocalBundle(source.dirPath);
      bundleDir = result.bundleDir;
      bundleVersion = result.manifest.version;
      sourcePin = buildPinForDirectorySource(source.dirPath, bundleVersion);
    }

    console.log(`[agentman] Bundle version: ${bundleVersion}`);
    const contents = await scanBundle(bundleDir);
    allSkills = contents.skills;
  }

  // Key by qualified identity so same-named skills from different sources both survive.
  // Two distinct sources collapsing onto one identity means a namespace-derivation gap;
  // warn rather than let the Map drop one of them silently.
  const availableSkills = new Map<string, (typeof allSkills)[number]>();
  for (const skill of allSkills) {
    const key = deriveSkillInstallKey(skill);
    const previous = availableSkills.get(key);
    if (previous && previous.dirPath !== skill.dirPath) {
      console.warn(
        `\n[agentman] WARNING: two sources resolved to the same identity '${key}'\n` +
          `  ${previous.dirPath}\n  ${skill.dirPath}\n` +
          `  Only the second will be installed.`,
      );
    }
    availableSkills.set(key, skill);
  }

  // Match requested skills (bare names from config resolved to qualified keys).
  const toInstall = [];
  const notFound = [];
  const ambiguous: string[] = [];

  for (const skillName of config.skills) {
    // The filter covers exact keys (flat installs) and bare names ending a qualified key.
    // Running every request through the same path catches the case where a bare name
    // matches both a flat key and a namespaced key — that must raise ambiguity, not
    // silently pick the flat one.
    const matches = [...availableSkills.keys()].filter(
      (k) => k === skillName || k.endsWith('/' + skillName),
    );
    if (matches.length === 1) {
      toInstall.push(availableSkills.get(matches[0])!);
    } else if (matches.length > 1) {
      console.error(
        `\n[agentman] ERROR: '${skillName}' is ambiguous — it matches multiple sources.\n` +
          `  Use one of these qualified names in the config file instead:\n` +
          matches.map((m) => `  - ${m}`).join('\n'),
      );
      ambiguous.push(skillName);
    } else {
      notFound.push(skillName);
    }
  }

  if (notFound.length > 0) {
    console.warn(`\n[agentman] WARNING: The following skills were not found in the bundle:`);
    for (const name of notFound) {
      console.warn(`  - ${name}`);
    }
    console.warn(`\n  Available skills: ${[...availableSkills.keys()].join(", ")}`);
  }

  if (
    source.type === 'discovery' &&
    isProjectsExclusiveSource(source.discovery.projects) &&
    notFound.length > 0
  ) {
    console.error(
      `\n[agentman] ERROR: projects.exclusiveSource is enabled — refusing to install skills that are ` +
        `not permitted by your project memberships (or were not found in the exclusive catalogue):\n` +
        notFound.map((name) => `  - ${name}`).join('\n'),
    );
    process.exit(1);
  }

  if (toInstall.length === 0) {
    console.error("\n[agentman] ERROR: No valid skills to install. Exiting.");
    process.exit(1);
  }

  // Install for each tool in sequence
  let hasErrors = ambiguous.length > 0;

  for (const toolId of config.tools) {
    console.log(`\n[agentman] Installing ${toInstall.length} skill(s) for ${toolId}...`);
    const provisioner = createSkillProvisioner(toolId, config.scope, repoRoot);
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
