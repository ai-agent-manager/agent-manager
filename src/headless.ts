import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { downloadBundle } from './bundle/downloader.js';
import { extractBundle } from './bundle/extractor.js';
import { importLocalBundle } from './bundle/importer.js';
import { scanBundle, type SkillInfo } from './bundle/scanner.js';
import { setCurrentBundle } from './bundle/cache.js';
import { resolveSource } from './bundle/source.js';
import { resolveDiscoverySkills } from './discovery/index.js';
import { authenticate } from './auth/index.js';
import { ClaudeCodeProvisioner } from './provisioners/ClaudeCodeProvisioner.js';
import { WindsurfProvisioner } from './provisioners/WindsurfProvisioner.js';
import { CopilotProvisioner } from './provisioners/CopilotProvisioner.js';
import { CursorProvisioner } from './provisioners/CursorProvisioner.js';
import type { SkillProvisioner } from './provisioners/SkillProvisioner.js';
import type { InstallScope } from './config/scopes.js';

export interface HeadlessConfig {
  tools: string[];
  scope: InstallScope;
  skills: string[];
  bundleVersion?: string;
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

  return {
    tools,
    scope,
    skills: parsed.skills as string[],
    bundleVersion,
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
  const config = await parseHeadlessConfig(configPath);
  const repoRoot = process.cwd();

  console.log(`\n[agentman] Headless install`);
  console.log(`  Config:  ${configPath}`);
  console.log(`  Tools:   ${config.tools.join(', ')}`);
  console.log(`  Scope:   ${config.scope}`);
  console.log(`  Skills:  ${config.skills.join(', ')}\n`);
  console.log(`  Bundle version: ${config.bundleVersion ?? 'latest'}\n`);

  // Acquire skills
  const source = await resolveSource(sourceInput);
  let allSkills: SkillInfo[];
  let bundleVersion: string;

  if (source.type === 'discovery') {
    console.log('[agentman] Discovery document found');

    let accessToken: string | undefined;
    if (source.discovery.auth?.required) {
      // In headless mode, use AGENTMAN_ACCESS_TOKEN env var or attempt cached token
      const envToken = process.env['AGENTMAN_ACCESS_TOKEN'];
      if (envToken) {
        accessToken = envToken;
        console.log('[agentman] Using access token from AGENTMAN_ACCESS_TOKEN');
      } else {
        console.log('[agentman] Attempting cached token authentication...');
        const authResult = await authenticate(
          source.baseUrl,
          source.discovery.auth,
          (url) => {
            // In headless mode, print the URL and exit — interactive login is not supported
            console.error(`\n[agentman] ERROR: Authentication required. Visit this URL to authorise:`);
            console.error(`  ${url}\n`);
            console.error(`  Or set AGENTMAN_ACCESS_TOKEN environment variable.\n`);
            process.exit(1);
          },
        );
        accessToken = authResult.accessToken;
      }
    }


    console.log(`[agentman] Resolving ${source.discovery.skills.length} skill(s) from discovery document...`);
    const result = await resolveDiscoverySkills(
      source.discovery,
      accessToken,
      (msg) => console.log(`[agentman] ${msg}`),
    );

    for (const { skill, error } of result.errors) {
      console.warn(`[agentman] WARNING: Failed to resolve skill '${skill.name}': ${error}`);
    }

    allSkills = result.skills;
    bundleVersion = result.bundleVersion ?? 'discovery';
  } else {
    let bundleDir: string;

    if (source.type === 'url') {
      console.log('[agentman] Downloading bundle...');
      const { zipPath } = await downloadBundle(source.baseUrl, config.bundleVersion);
      console.log('[agentman] Extracting bundle...');
      const result = await extractBundle(zipPath);
      bundleDir = result.bundleDir;
      bundleVersion = result.manifest.version;
      if (result.isNew) {
        await setCurrentBundle(bundleVersion);
      }
    } else {
      console.log('[agentman] Importing local bundle...');
      const result = await importLocalBundle(source.dirPath);
      bundleDir = result.bundleDir;
      bundleVersion = result.manifest.version;
    }

    console.log(`[agentman] Bundle version: ${bundleVersion}`);
    const contents = await scanBundle(bundleDir);
    allSkills = contents.skills;
  }

  const availableSkills = new Map(allSkills.map(s => [s.dirName, s]));

  // Match requested skills
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
    console.warn(`\n[agentman] WARNING: The following skills were not found in the bundle:`);
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
    const result = await provisioner.install(toInstall, bundleVersion);

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