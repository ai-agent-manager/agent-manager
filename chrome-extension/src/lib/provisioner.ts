/**
 * Rovo Agent Provisioner — DOM-based port of the Playwright RovoProvisioner.
 *
 * This module runs inside a content script on studio.atlassian.com and
 * performs the same automation as the CLI's RovoProvisioner, but using
 * native DOM APIs instead of Playwright.
 *
 * The step sequence, selectors, and fallback logic are identical to
 * agent-manager/src/provisioners/RovoProvisioner.ts.
 */

import {
  waitForTimeout,
  waitForSelector,
  waitForElement,
  getByTestId,
  getByRole,
  getByPlaceholder,
  fill,
  click,
  pressKey,
  check,
  uncheck,
  tryWithFallback,
} from './dom-helpers.js';

import type {
  RovoAgentConfig,
  RovoDefaultScenario,
  RovoCustomScenario,
} from './types.js';

export type ProgressCallback = (message: string, step: number, total: number) => void;

/**
 * Provision a Rovo agent in Atlassian Studio by automating the web UI.
 *
 * Assumes the user is already logged in (the page is loaded in their
 * authenticated browser session) and is on an agents page in Studio.
 *
 * @param config    The fully-resolved agent configuration.
 * @param onProgress  Callback for reporting step-by-step progress.
 */
export async function provisionAgent(
  config: RovoAgentConfig,
  onProgress: ProgressCallback
): Promise<void> {
  const customScenarioCount = config.scenarios.custom?.length ?? 0;
  // Steps: create(1) + identity(2) + default scenario(3)
  //        + N custom scenarios + activate(last)
  const totalSteps = 4 + customScenarioCount;

  // Step 1: Click "Create an agent" and select "Rovo agent"
  onProgress('Creating agent...', 1, totalSteps);
  await createNewAgent();

  // Step 2: Configure identity
  onProgress('Configuring identity...', 2, totalSteps);
  await configureIdentity(config);

  // Step 3: Configure default scenario
  onProgress('Configuring default scenario...', 3, totalSteps);
  await configureDefaultScenario(config.scenarios.default);

  // Steps 4..N: Additional custom scenarios
  if (config.scenarios.custom?.length) {
    for (let i = 0; i < config.scenarios.custom.length; i++) {
      const scenario = config.scenarios.custom[i];
      onProgress(`Adding scenario: ${scenario.name}...`, 4 + i, totalSteps);
      await addCustomScenario(scenario);
    }
  }

  // Final step: Activate
  onProgress('Activating agent...', totalSteps, totalSteps);
  await activateAgent();
}

// ---------------------------------------------------------------------------
// Step 1: Create a new Rovo agent
// ---------------------------------------------------------------------------

async function createNewAgent(): Promise<void> {
  // Wait for the page to be ready
  await waitForTimeout(2000);

  // Click "Create an agent"
  await tryWithFallback(
    async () => {
      const btn = await waitForSelector('[data-testid="create-agent-button-trigger"]');
      click(btn);
    },
    async () => {
      const btn = await waitForElement(
        () => getByRole('button', { name: /Create an agent/i }),
        '"Create an agent" button'
      );
      click(btn);
    }
  );
  await waitForTimeout(1000);

  // Select "Rovo agent" from dropdown
  await tryWithFallback(
    async () => {
      const item = await waitForSelector('[data-testid="create-rovo-agent-menu-item"]');
      click(item);
    },
    async () => {
      const item = await waitForElement(
        () => getByRole('menuitem', { name: /Rovo agent/i }),
        '"Rovo agent" menu item'
      );
      click(item);
    }
  );
  await waitForTimeout(2000);

  // Skip to manual setup
  await tryWithFallback(
    async () => {
      const btn = await waitForSelector('[data-testid="nl-create-skip-to-manual-setup-button"]');
      click(btn);
    },
    async () => {
      const btn = await waitForElement(
        () => getByRole('button', { name: /Skip to manual setup/i }),
        '"Skip to manual setup" button'
      );
      click(btn);
    }
  );
  await waitForTimeout(2000);
}

// ---------------------------------------------------------------------------
// Step 2: Configure identity
// ---------------------------------------------------------------------------

async function configureIdentity(config: RovoAgentConfig): Promise<void> {
  // Navigate to Identity page via sidebar
  try {
    const navItem = await waitForSelector('[data-testid="side-navigation-menu-item-identity"]');
    click(navItem);
    await waitForTimeout(1500);
  } catch {
    return;
  }

  const { identity } = config;

  // Name (max 30 chars)
  try {
    const nameInput = getByTestId('agent-identity-name-field-input');
    if (nameInput) fill(nameInput, identity.name);
  } catch { /* optional */ }
  await waitForTimeout(500);

  // Description (max 400 chars)
  try {
    const descInput = getByTestId('agent-identity-description-field-input');
    if (descInput) fill(descInput, identity.description);
  } catch { /* optional */ }
  await waitForTimeout(500);

  // Behaviour
  try {
    const behaviorInput = getByTestId('agent-identity-behaviour-field-input');
    if (behaviorInput) fill(behaviorInput, identity.behavior);
  } catch { /* optional */ }
  await waitForTimeout(500);

  // Conversation starters
  if (identity.conversationStarters?.length) {
    await fillConversationStarters(identity.conversationStarters);
  }
}

async function fillConversationStarters(starters: string[]): Promise<void> {
  try {
    for (const starter of starters) {
      const inputs = getByPlaceholder('Write a new conversation starter');
      const emptyInput = inputs[inputs.length - 1];
      if (!emptyInput) break;

      fill(emptyInput, starter);
      await waitForTimeout(300);
      pressKey(emptyInput, 'Tab');
      await waitForTimeout(800);
    }
  } catch {
    // Conversation starters are optional — don't fail the whole flow
  }
}

// ---------------------------------------------------------------------------
// Step 3: Configure default scenario
// ---------------------------------------------------------------------------

async function configureDefaultScenario(scenario: RovoDefaultScenario): Promise<void> {
  // Navigate to default scenario via sidebar
  try {
    const navItem = await waitForSelector('[data-testid="side-navigation-menu-item-default-scenario"]');
    click(navItem);
    await waitForTimeout(1500);
  } catch {
    return;
  }

  await fillScenarioFields(scenario, true);
}

// ---------------------------------------------------------------------------
// Step 4+: Add custom scenarios
// ---------------------------------------------------------------------------

async function addCustomScenario(scenario: RovoCustomScenario): Promise<void> {
  try {
    // Click "Add new scenario" in the sidebar
    const addBtn = await waitForElement(
      () => getByRole('button', { name: 'Add new scenario' }),
      '"Add new scenario" button'
    );
    click(addBtn);
    await waitForTimeout(2000);

    // Fill scenario name
    const nameInput = getByRole('textbox', { name: 'Scenario name' });
    if (nameInput) {
      fill(nameInput, scenario.name);
      await waitForTimeout(500);
    }

    // Fill trigger
    if (scenario.trigger) {
      const triggerInput = getByRole('textbox', { name: 'Trigger' });
      if (triggerInput) {
        fill(triggerInput, scenario.trigger);
        await waitForTimeout(500);
      }
    }

    // Fill the rest of the scenario fields
    await fillScenarioFields(scenario, false);
  } catch { /* optional */ }
}

// ---------------------------------------------------------------------------
// Shared scenario field filling
// ---------------------------------------------------------------------------

async function fillScenarioFields(
  scenario: RovoDefaultScenario | RovoCustomScenario,
  isDefault: boolean
): Promise<void> {
  // Instructions
  try {
    const instrInput = getByRole('textbox', { name: 'Instructions' });
    if (instrInput) fill(instrInput, scenario.instructions);
  } catch { /* optional */ }
  await waitForTimeout(500);

  // Knowledge radio selection
  await selectKnowledge(scenario.knowledge ?? 'all');

  // Web search checkbox
  await setCheckbox('Web search', scenario.webSearch ?? false);

  // Deep research checkbox — only available on custom scenarios
  if (!isDefault && 'deepResearch' in scenario) {
    await setCheckbox('Deep research', (scenario as RovoCustomScenario).deepResearch ?? false);
  }

  // Skills
  if (scenario.skills?.length) {
    await addSkillsToScenario(scenario.skills);
  }
}

async function selectKnowledge(knowledge: 'all' | 'custom' | 'none'): Promise<void> {
  try {
    const testIdMap: Record<string, string> = {
      all: 'rovo-scenario-page-knowledge-sources-all-radio--radio-input',
      custom: 'rovo-scenario-page-knowledge-sources-custom-radio--radio-input',
      none: 'rovo-scenario-page-knowledge-sources-none-radio--radio-input',
    };

    const radio = getByTestId(testIdMap[knowledge]);
    if (radio) click(radio);
  } catch { /* optional */ }
  await waitForTimeout(500);
}

async function setCheckbox(name: string, checked: boolean): Promise<void> {
  try {
    const checkbox = getByRole('checkbox', { name });
    if (checkbox) {
      if (checked) {
        check(checkbox);
      } else {
        uncheck(checkbox);
      }
    }
  } catch { /* optional */ }
  await waitForTimeout(500);
}

async function addSkillsToScenario(skillNames: string[]): Promise<void> {
  try {
    // Open skills dialog
    const trigger = await waitForSelector('[data-testid="scenario-tools-modal-trigger"]');
    click(trigger);
    await waitForTimeout(1500);

    for (const skillName of skillNames) {
      const searchBox = getByRole('textbox', { name: /Search for a skill/i });
      if (!searchBox) continue;

      fill(searchBox, skillName);
      await waitForTimeout(1000);

      try {
        const selectBtn = await waitForElement(
          () => getByRole('button', { name: new RegExp(`Select ${skillName}`, 'i') }),
          `"Select ${skillName}" button`,
          5000
        );
        click(selectBtn);
      } catch { /* skill may not exist */ }
      await waitForTimeout(500);
    }

    // Confirm selection
    const addBtn = getByTestId('tools-footer-add-button');
    if (addBtn) click(addBtn);
    await waitForTimeout(1000);
  } catch { /* optional */ }
}

// ---------------------------------------------------------------------------
// Final step: Activate the agent
// ---------------------------------------------------------------------------

async function activateAgent(): Promise<void> {
  try {
    const activateBtn = await waitForSelector('[data-testid="activate-agent-create-button"]');
    click(activateBtn);
    await waitForTimeout(2000);

    // Dismiss "No thanks" dialog if it appears
    try {
      const noThanks = getByRole('button', { name: 'No thanks' });
      if (noThanks) {
        click(noThanks);
      }
    } catch { /* dialog may not appear */ }

    await waitForTimeout(3000);
  } catch { /* optional */ }
}
