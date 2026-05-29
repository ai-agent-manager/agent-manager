#!/usr/bin/env npx tsx
/**
 * Live test script for the Rovo provisioner.
 *
 * Usage:
 *   npx tsx scripts/test-rovo-live.ts auth       # Step 1: authenticate (headed browser)
 *   npx tsx scripts/test-rovo-live.ts create      # Step 2: create agent from example YAML
 *   npx tsx scripts/test-rovo-live.ts create-headed  # Step 2 alt: create agent headed (visible)
 *
 * The auth step opens a browser for you to log in manually. Once done, the
 * session is saved to ~/.agentman/auth/ and reused by create.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RovoProvisioner } from '../src/provisioners/RovoProvisioner.js';
import { parseRovoAgentYaml } from '../src/bundle/scanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STUDIO_URL =
  'https://studio.atlassian.com/s/ff6d57b2-b3bf-457b-af55-6dea3dbd4f9a/agents';

const EXAMPLE_YAML = resolve(
  __dirname,
  '../examples/epic-elaboration-agent/rovo-agent.yaml'
);

async function main() {
  const command = process.argv[2];

  if (!command || !['auth', 'create', 'create-headed'].includes(command)) {
    console.log('Usage:');
    console.log('  npx tsx scripts/test-rovo-live.ts auth           # Log in interactively');
    console.log('  npx tsx scripts/test-rovo-live.ts create         # Create agent (headless)');
    console.log('  npx tsx scripts/test-rovo-live.ts create-headed  # Create agent (visible)');
    process.exit(1);
  }

  const provisioner = new RovoProvisioner({
    onProgress: (msg, step, total) => {
      if (step && total) {
        console.log(`[${step}/${total}] ${msg}`);
      } else {
        console.log(msg);
      }
    },
  });

  if (command === 'auth') {
    console.log('--- Authenticating with Atlassian Studio ---');
    console.log(`Studio URL: ${STUDIO_URL}`);
    console.log('A browser window will open. Please log in and wait for it to close.\n');
    await provisioner.authenticate(STUDIO_URL);
    console.log('\nAuth state saved. You can now run: npx tsx scripts/test-rovo-live.ts create');
    return;
  }

  // create or create-headed
  const headless = command === 'create';

  console.log(`--- Creating Rovo Agent (${headless ? 'headless' : 'headed'}) ---`);

  // Check auth
  const hasAuth = await provisioner.hasValidAuth();
  if (!hasAuth) {
    console.error('ERROR: No valid auth state. Run auth first:');
    console.error('  npx tsx scripts/test-rovo-live.ts auth');
    process.exit(1);
  }

  // Parse the example YAML
  console.log(`Loading: ${EXAMPLE_YAML}`);
  const yamlContent = readFileSync(EXAMPLE_YAML, 'utf-8');
  const config = await parseRovoAgentYaml(yamlContent, dirname(EXAMPLE_YAML));

  console.log(`Agent: ${config.identity.name}`);
  console.log(`Description: ${config.identity.description}`);
  console.log(`Default scenario: ${config.scenarios.default.instructions.substring(0, 60)}...`);
  console.log(`Custom scenarios: ${config.scenarios.custom?.length ?? 0}`);
  console.log(`Knowledge sources: ${config.knowledgeSources?.length ?? 0}`);
  console.log('');

  await provisioner.createAgent({
    studioUrl: STUDIO_URL,
    config,
    headless,
  });

  console.log('\nDone! Check Studio to verify the agent was created correctly.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
