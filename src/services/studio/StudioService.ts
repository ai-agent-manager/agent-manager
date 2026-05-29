import type {
  RovoAgentConfig,
  RovoDefaultScenario,
  RovoCustomScenario,
} from '../../bundle/scanner.js';
import type { KnowledgePage } from '../confluence/types.js';
import type { ProgressCallback } from '../../provisioners/types.js';

/**
 * Service that automates Rovo agent creation in Atlassian Studio via
 * Playwright page interactions.
 *
 * The caller owns browser/context lifecycle and passes a ready-to-use
 * Playwright `Page` instance.  This service is a stateless helper that
 * operates on the page it receives.
 */
export class StudioService {
  private page: import('playwright').Page;
  private log: ProgressCallback;

  constructor(page: import('playwright').Page, onProgress?: ProgressCallback) {
    this.page = page;
    this.log = onProgress ?? (() => {});
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a Rovo agent in Atlassian Studio.
   *
   * Assumes the page already has a valid authenticated session (via
   * `storageState`) and the browser context is ready to use.
   *
   * @param studioUrl     - Atlassian Studio workspace URL
   * @param config        - Agent configuration (identity, scenarios, knowledge sources)
   * @param knowledgePages - Confluence pages to link as custom knowledge (child pages only)
   * @param step          - Starting step number for progress reporting
   * @param totalSteps    - Total steps for progress reporting
   */
  async createAgent(options: {
    studioUrl: string;
    config: RovoAgentConfig;
    knowledgePages?: KnowledgePage[];
    step?: number;
    totalSteps?: number;
  }): Promise<void> {
    const { studioUrl, config, knowledgePages = [] } = options;
    const s = options.step ?? 1;
    const totalSteps = options.totalSteps ?? 5;
    const page = this.page;

    await page.goto(studioUrl);
    this.log('Navigated to Atlassian Studio', s, totalSteps);

    // Brief wait for page to settle with restored session
    await page.waitForTimeout(2000);

    // Click "Create an agent"
    this.log('Creating agent...', s + 1, totalSteps);
    await page.waitForTimeout(2000);
    try {
      await page.getByTestId('create-agent-button-trigger').click();
    } catch {
      await page.getByRole('button', { name: /Create an agent/i }).click();
    }
    await page.waitForTimeout(1000);

    // Select "Rovo agent" from dropdown
    try {
      await page.getByTestId('create-rovo-agent-menu-item').click();
    } catch {
      await page.getByRole('menuitem', { name: /Rovo agent/i }).click();
    }
    await page.waitForTimeout(2000);

    // Skip to manual setup
    try {
      await page.getByTestId('nl-create-skip-to-manual-setup-button').click();
    } catch {
      await page.getByRole('button', { name: /Skip to manual setup/i }).click();
    }
    await page.waitForTimeout(2000);

    // Configure identity
    this.log('Configuring identity...', s + 2, totalSteps);
    await this.configureIdentity(config);

    // Configure default scenario
    this.log('Configuring default scenario...', s + 3, totalSteps);
    await this.configureDefaultScenario(config.scenarios.default, knowledgePages);

    // Additional custom scenarios
    if (config.scenarios.custom?.length) {
      for (let i = 0; i < config.scenarios.custom.length; i++) {
        const scenario = config.scenarios.custom[i];
        this.log(`Adding scenario: ${scenario.name}...`, s + 4 + i, totalSteps);
        try {
          await this.addCustomScenario(scenario, knowledgePages);
        } catch (err) {
          this.log(`ERROR adding scenario "${scenario.name}": ${err instanceof Error ? err.message : String(err)}`);
          throw err;
        }
      }
    }

    // Activate
    this.log('Activating agent...', totalSteps, totalSteps);
    await this.activateAgent();

    this.log('Agent created successfully!');
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  /**
   * Navigate to the Identity page and fill in name, description, behaviour,
   * and conversation starters.
   */
  private async configureIdentity(config: RovoAgentConfig): Promise<void> {
    const page = this.page;

    // Navigate to Identity page via sidebar
    try {
      await page.getByTestId('side-navigation-menu-item-identity').click();
      await page.waitForTimeout(1500);
    } catch { return; }

    const { identity } = config;

    // Name (max 30 chars)
    try { await page.getByTestId('agent-identity-name-field-input').fill(identity.name); } catch {}
    await page.waitForTimeout(500);

    // Description (max 400 chars)
    try { await page.getByTestId('agent-identity-description-field-input').fill(identity.description); } catch {}
    await page.waitForTimeout(500);

    // Behaviour
    try { await page.getByTestId('agent-identity-behaviour-field-input').fill(identity.behavior); } catch {}
    await page.waitForTimeout(500);

    // Conversation starters
    if (identity.conversationStarters?.length) {
      await this.fillConversationStarters(identity.conversationStarters);
    }
  }

  /**
   * Fill conversation starter fields on the Identity page.
   */
  private async fillConversationStarters(starters: string[]): Promise<void> {
    const page = this.page;
    try {
      for (const starter of starters) {
        const emptyInput = page.getByPlaceholder('Write a new conversation starter').last();
        await emptyInput.fill(starter);
        await page.waitForTimeout(300);
        await emptyInput.press('Tab');
        await page.waitForTimeout(800);
      }
    } catch {
      // Conversation starters are optional — don't fail the whole flow
    }
  }

  // ---------------------------------------------------------------------------
  // Scenarios
  // ---------------------------------------------------------------------------

  /**
   * Navigate to the Default Scenario page and configure it.
   */
  private async configureDefaultScenario(
    scenario: RovoDefaultScenario,
    knowledgePages: KnowledgePage[] = [],
  ): Promise<void> {
    const page = this.page;
    try {
      await page.getByTestId('side-navigation-menu-item-default-scenario').click();
      await page.waitForTimeout(1500);
    } catch { return; }

    await this.fillScenarioFields(scenario, /* isDefault */ true, knowledgePages);
  }

  /**
   * Add a new custom scenario and configure it.
   */
  private async addCustomScenario(
    scenario: RovoCustomScenario,
    knowledgePages: KnowledgePage[] = [],
  ): Promise<void> {
    const page = this.page;

    // Click "Add new scenario" in the sidebar
    await page.getByRole('button', { name: 'Add new scenario' }).click();
    await page.waitForTimeout(2000);

    // Fill scenario name — try a few selector strategies
    try {
      await page.getByRole('textbox', { name: /scenario name/i }).fill(scenario.name);
    } catch {
      const inputs = page.getByRole('textbox');
      const count = await inputs.count();
      let filled = false;
      for (let i = 0; i < count; i++) {
        const box = inputs.nth(i);
        const val = await box.inputValue().catch(() => null);
        if (val !== null && val.trim() === '') {
          await box.fill(scenario.name);
          filled = true;
          break;
        }
      }
      if (!filled) {
        throw new Error(`Could not locate scenario name input for "${scenario.name}"`);
      }
    }
    await page.waitForTimeout(500);

    // Fill trigger
    if (scenario.trigger) {
      try {
        await page.getByRole('textbox', { name: /trigger/i }).fill(scenario.trigger);
      } catch {
        throw new Error(`Could not locate trigger input for scenario "${scenario.name}"`);
      }
      await page.waitForTimeout(500);
    }

    // Enable/disable the scenario toggle
    const isEnabled = scenario.enabled ?? true;
    await this.setScenarioEnabled(isEnabled);

    // Fill the rest of the scenario fields
    await this.fillScenarioFields(scenario, /* isDefault */ false, knowledgePages);
  }

  /**
   * Fill the common scenario fields: instructions, knowledge, web search,
   * deep research (custom only), and skills.
   */
  private async fillScenarioFields(
    scenario: RovoDefaultScenario | RovoCustomScenario,
    isDefault: boolean,
    knowledgePages: KnowledgePage[] = [],
  ): Promise<void> {
    const page = this.page;

    // Instructions
    try {
      await page.getByRole('textbox', { name: 'Instructions' }).fill(scenario.instructions);
    } catch {}
    await page.waitForTimeout(500);

    // Knowledge selection
    const scenarioKnowledge = scenario.knowledge ?? 'all';
    const shouldLinkPages = knowledgePages.length > 0 && scenarioKnowledge === 'custom';
    const knowledgeMode = shouldLinkPages ? 'custom' : scenarioKnowledge;
    await this.selectKnowledge(knowledgeMode);

    if (shouldLinkPages) {
      await this.addConfluencePageKnowledge(knowledgePages);
    }

    // Web search checkbox
    await this.setCheckbox('Web search', scenario.webSearch ?? false);

    // Deep research checkbox — only available on custom scenarios
    if (!isDefault && 'deepResearch' in scenario) {
      await this.setCheckbox('Deep research', scenario.deepResearch ?? false);
    }

    // Skills
    if (scenario.skills?.length) {
      await this.addSkillsToScenario(scenario.skills);
    }
  }

  // ---------------------------------------------------------------------------
  // Knowledge
  // ---------------------------------------------------------------------------

  /**
   * Link specific Confluence pages as custom knowledge sources for a scenario.
   */
  private async addConfluencePageKnowledge(knowledgePages: KnowledgePage[]): Promise<void> {
    const page = this.page;
    try {
      // Open the Confluence content picker
      try {
        await page.getByTestId('knowledge-sources-add-confluence-button').click();
      } catch {
        try {
          await page.getByRole('button', { name: /Add Confluence|Add content|Add pages/i }).first().click();
        } catch {
          await page.getByRole('button', { name: /Add/i }).first().click();
        }
      }
      await page.waitForTimeout(1500);

      for (const kbPage of knowledgePages) {
        try {
          const searchInput = page.getByRole('textbox', { name: /Search|Filter|Find/i }).first();
          await searchInput.fill(kbPage.title);
          await page.waitForTimeout(1000);

          try {
            await page.getByRole('option', { name: new RegExp(kbPage.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first().click();
          } catch {
            await page.getByText(kbPage.title).first().click();
          }
          await page.waitForTimeout(500);
        } catch {
          // A single page failing should not abort the rest
        }
      }

      // Confirm the selection
      try {
        await page.getByTestId('knowledge-sources-picker-confirm-button').click();
      } catch {
        try {
          await page.getByRole('button', { name: /Confirm|Done|Save|Add/i }).last().click();
        } catch {}
      }
      await page.waitForTimeout(1000);
    } catch {
      // Knowledge picker unavailable — don't fail provisioning
    }
  }

  /**
   * Select the knowledge radio button for a scenario.
   */
  private async selectKnowledge(knowledge: 'all' | 'custom' | 'none'): Promise<void> {
    const page = this.page;
    try {
      switch (knowledge) {
        case 'all':
          await page.getByTestId('rovo-scenario-page-knowledge-sources-all-radio--radio-input').click();
          break;
        case 'custom':
          await page.getByTestId('rovo-scenario-page-knowledge-sources-custom-radio--radio-input').click();
          break;
        case 'none':
          await page.getByTestId('rovo-scenario-page-knowledge-sources-none-radio--radio-input').click();
          break;
      }
    } catch {
      // Fallback: try by visible label text, then positional index
      try {
        const labelMap: Record<string, RegExp> = {
          all: /all\s+(organi[sz]ation|atlassian|knowledge)/i,
          custom: /custom/i,
          none: /none/i,
        };
        const indexMap: Record<string, number> = { all: 0, custom: 1, none: 2 };
        try {
          await page.getByRole('radio', { name: labelMap[knowledge] }).first().click();
        } catch {
          await page.getByRole('radio').nth(indexMap[knowledge]).click();
        }
      } catch {}
    }
    await page.waitForTimeout(500);
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  /**
   * Set a checkbox to checked or unchecked.
   */
  private async setCheckbox(name: string, checked: boolean): Promise<void> {
    const page = this.page;
    try {
      const checkbox = page.getByRole('checkbox', { name });
      if (checked) {
        await checkbox.check();
      } else {
        await checkbox.uncheck();
      }
    } catch {}
    await page.waitForTimeout(500);
  }

  /**
   * Toggle the Enabled switch on a custom scenario.
   */
  private async setScenarioEnabled(enabled: boolean): Promise<void> {
    const page = this.page;

    // Strategy 1: direct ID selector
    try {
      const toggle = page.locator('#isActive');
      if (await toggle.count() > 0) {
        const isChecked = await toggle.isChecked();
        if (isChecked !== enabled) {
          if (enabled) {
            await toggle.check({ force: true });
          } else {
            await toggle.uncheck({ force: true });
          }
          await page.waitForTimeout(500);
        }
        return;
      }
    } catch {}

    // Strategy 2: label for "isActive"
    try {
      const label = page.locator('label[for="isActive"]');
      if (await label.count() > 0) {
        await label.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch {}

    // Strategy 3: role-based fallback
    try {
      const toggle = page.getByRole('checkbox', { name: /enabled/i });
      if (await toggle.count() > 0) {
        const isChecked = await toggle.isChecked();
        if (isChecked !== enabled) {
          await toggle.click({ force: true });
          await page.waitForTimeout(500);
        }
        return;
      }
    } catch {}
  }

  /**
   * Open the skills dialog, search for and select each skill by name, then confirm.
   */
  private async addSkillsToScenario(skillNames: string[]): Promise<void> {
    const page = this.page;
    try {
      await page.getByTestId('scenario-tools-modal-trigger').click();
      await page.waitForTimeout(1500);

      for (const skillName of skillNames) {
        const searchBox = page.getByRole('textbox', { name: /Search for a skill/i });
        await searchBox.fill(skillName);
        await page.waitForTimeout(1500);

        const listItem = page.locator('[data-testid^="tools-list-item-"]').filter({ hasText: skillName }).first();
        try {
          await listItem.locator('[data-testid="pressable-card-trigger-hitbox"]').click();
        } catch {
          try {
            await listItem.click();
          } catch {}
        }
        await page.waitForTimeout(500);
      }

      await page.getByTestId('tools-footer-add-button').click();
      await page.waitForTimeout(1000);
    } catch {}
  }

  /**
   * Click the Activate button to publish the agent, then dismiss any follow-up dialog.
   */
  private async activateAgent(): Promise<void> {
    const page = this.page;
    try {
      await page.getByTestId('activate-agent-create-button').click();
      await page.waitForTimeout(2000);

      try {
        const noThanks = page.getByRole('button', { name: 'No thanks' });
        if (await noThanks.isVisible({ timeout: 2000 })) {
          await noThanks.click();
        }
      } catch {}

      await page.waitForTimeout(3000);
    } catch {}
  }
}
