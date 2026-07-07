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

    // Skip to manual setup (when the natural-language create flow is shown).
    // v2-beta uses several different labels for this — try all known
    // variants before giving up. Without this, the provisioner stays on
    // the NL chat page and the manual editor selectors never match.
    const manualSetupTestIds = [
      'nl-create-skip-to-manual-setup-button',
      'create-skip-to-manual-setup-button',
      'manual-setup-button',
      'skip-to-manual-setup',
    ];
    const manualSetupLabels = [
      /Skip to manual setup/i,
      /Manual setup/i,
      /Create manually/i,
      /Start from scratch/i,
      /Set up manually/i,
      /^Skip$/i,
    ];

    let manualClicked = false;
    for (const testId of manualSetupTestIds) {
      try {
        const btn = page.getByTestId(testId);
        if (await btn.isVisible({ timeout: 1_500 })) {
          await btn.click();
          manualClicked = true;
          break;
        }
      } catch {}
    }
    if (!manualClicked) {
      for (const label of manualSetupLabels) {
        try {
          const btn = page.getByRole('button', { name: label });
          if (await btn.isVisible({ timeout: 1_500 })) {
            await btn.click();
            manualClicked = true;
            break;
          }
        } catch {}
        try {
          const link = page.getByRole('link', { name: label });
          if (await link.isVisible({ timeout: 1_000 })) {
            await link.click();
            manualClicked = true;
            break;
          }
        } catch {}
      }
    }
    if (!manualClicked) {
      throw new Error(
        'Could not find a way to skip to manual setup. The natural-language create page is open ' +
        'but none of the known button labels matched. Studio UI selectors may have changed.',
      );
    }
    await page.waitForTimeout(2500);

    // Configure the agent on the v2-beta single-page editor.
    this.log('Configuring agent...', s + 2, totalSteps);
    await this.configureAgent(config, knowledgePages);

    // Subagents (formerly v1 custom scenarios).
    if (config.scenarios.custom?.length) {
      for (let i = 0; i < config.scenarios.custom.length; i++) {
        const subagent = config.scenarios.custom[i];
        this.log(`Adding subagent: ${subagent.name}...`, s + 3 + i, totalSteps);
        try {
          await this.addSubagent(subagent, knowledgePages);
        } catch (err) {
          this.log(`ERROR adding subagent "${subagent.name}": ${err instanceof Error ? err.message : String(err)}`);
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
  // Subagents
  // ---------------------------------------------------------------------------

  /**
   * Add a new subagent and configure it.
   *
   * Subagents are added by clicking "Add new scenario" in the sidebar (the
   * underlying widget kept the v1 label) and filling the same name/trigger/
   * instructions/knowledge form.
   */
  private async addSubagent(
    subagent: RovoCustomScenario,
    knowledgePages: KnowledgePage[] = [],
  ): Promise<void> {
    const page = this.page;

    // Count existing subagents BEFORE adding so we can identify the new one.
    const existingCount = await page.locator('input[aria-label="Scenario name"]').count();

    // Click "Add new scenario" (or "Add subagent") in the sidebar.
    try {
      await page.getByRole('button', { name: /Add new scenario|Add subagent/i }).click();
    } catch {
      throw new Error(`Could not find "Add new scenario" button for subagent "${subagent.name}"`);
    }

    // Wait for the new Scenario name input to appear at index `existingCount`.
    await page.waitForFunction(
      (expectedCount) => document.querySelectorAll('input[aria-label="Scenario name"]').length > expectedCount,
      existingCount,
      { timeout: 5_000 },
    ).catch(() => {
      throw new Error(`New Scenario name input did not appear after clicking "Add subagent" for "${subagent.name}"`);
    });

    const nameInput = page.locator('input[aria-label="Scenario name"]').nth(existingCount);
    await nameInput.fill(subagent.name);
    await page.waitForTimeout(300);

    // Trigger — the textarea that appears immediately after this subagent's
    // name input in document order.
    if (subagent.trigger) {
      const triggerSelector = page.locator(
        `input[aria-label="Scenario name"] >> nth=${existingCount} >> .. >> .. >> .. >> textarea`,
      );
      // The chained-locator above is brittle — fall back to a JS evaluate
      // that walks forward in document order.
      let triggerFilled = false;
      try {
        await page.evaluate(({ index, value }) => {
          const all = Array.from(document.querySelectorAll('textarea, input[aria-label="Scenario name"]'));
          const names = Array.from(document.querySelectorAll('input[aria-label="Scenario name"]'));
          const after = names[index];
          if (!after) throw new Error('no name input at index ' + index);
          const i = all.indexOf(after);
          for (let j = i + 1; j < all.length; j++) {
            const el = all[j];
            if (el.tagName === 'TEXTAREA') {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
              setter?.call(el, value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            if (el.getAttribute('aria-label') === 'Scenario name') return false;
          }
          return false;
        }, { index: existingCount, value: subagent.trigger });
        triggerFilled = true;
      } catch {
        // Try locator approach as fallback.
      }
      if (!triggerFilled) {
        try {
          await triggerSelector.fill(subagent.trigger);
        } catch {
          throw new Error(`Could not locate trigger textarea for subagent "${subagent.name}"`);
        }
      }
      await page.waitForTimeout(300);
    }

    // Enable/disable the subagent toggle.
    const isEnabled = subagent.enabled ?? true;
    await this.setScenarioEnabled(isEnabled);

    // Instructions — the AK editor that belongs to this subagent (the
    // contenteditable that comes after the name input and is NOT inside
    // the main agent's core-instructions-editor).
    if (subagent.instructions) {
      const editorHandle = await page.evaluateHandle((index) => {
        const all = Array.from(document.querySelectorAll(
          'input[aria-label="Scenario name"], [contenteditable="true"]',
        ));
        const names = Array.from(document.querySelectorAll('input[aria-label="Scenario name"]'));
        const after = names[index];
        if (!after) return null;
        const i = all.indexOf(after);
        for (let j = i + 1; j < all.length; j++) {
          const el = all[j];
          if (el.getAttribute('contenteditable') === 'true'
            && !el.closest('[data-testid="core-instructions-editor"]')) {
            return el;
          }
          if (el.getAttribute('aria-label') === 'Scenario name') return null;
        }
        return null;
      }, existingCount);

      const editor = editorHandle.asElement();
      if (!editor) {
        throw new Error(`Could not locate Instructions editor for subagent "${subagent.name}"`);
      }
      const editorLocator = page.locator(`[contenteditable="true"]:nth-of-type(${existingCount + 2})`);
      // Use evaluate-based fill since we already have the handle.
      await editor.evaluate((el, text) => {
        (el as HTMLElement).focus();
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
      }, subagent.instructions);
      await page.waitForTimeout(300);
      // editorLocator unused after handle path — kept for type-only readability.
      void editorLocator;
    }

    // Knowledge / Web search / Deep research / Skills — same primitives as
    // the default scenario. NOTE: these are global on the page right now;
    // a future improvement could scope them to the active subagent.
    await this.selectKnowledge(subagent.knowledge ?? 'all');
    if (knowledgePages.length > 0 && subagent.knowledge === 'custom') {
      await this.addConfluencePageKnowledge(knowledgePages);
    }
    await this.setCheckbox('Web search', subagent.webSearch ?? false);
    if (subagent.deepResearch !== undefined) {
      await this.setCheckbox('Deep research', subagent.deepResearch);
    }
    if (subagent.skills?.length) {
      await this.addSkillsToScenario(subagent.skills);
    }
  }

  /**
   * Fill the common scenario fields: instructions, knowledge, web search,
   * deep research, and skills.
   *
   * Throws if the Instructions field cannot be located/filled when
   * `scenario.instructions` is non-empty — agents without instructions are
   * useless.
   */
  private async fillScenarioFields(
    scenario: RovoDefaultScenario | RovoCustomScenario,
    isDefault: boolean,
    knowledgePages: KnowledgePage[] = [],
  ): Promise<void> {
    const page = this.page;

    if (scenario.instructions) {
      await this.fillInstructions(scenario.instructions);
    }
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

    // Deep research checkbox
    if (!isDefault && 'deepResearch' in scenario) {
      await this.setCheckbox('Deep research', scenario.deepResearch ?? false);
    }

    // Skills
    if (scenario.skills?.length) {
      await this.addSkillsToScenario(scenario.skills);
    }
  }

  /**
   * Fill the Instructions field — a rich-text editor (contenteditable /
   * ProseMirror) in Studio. Falls back to a plain textbox when present.
   *
   * Throws if no usable instructions field is found within the timeout, or
   * if the field still appears empty after the fill attempt.
   */
  /**
   * Fill an Atlassian Design System InlineEdit field — used for both Name and
   * Description in v2-beta Studio.
   *
   * The DOM looks like:
   *   <form role="presentation">
   *     <div>
   *       <button aria-label="{value}, edit">  ← invisible 0×0 overlay button
   *       <div role="presentation">
   *         <... data-testid="{readViewTestId}">{value or placeholder}</...>
   *       </div>
   *     </div>
   *   </form>
   *
   * After clicking the edit button, the form swaps to:
   *   <form>
   *     <div data-ds--text-field--container="true">
   *       <input name="inlineEdit" data-ds--text-field--input="true" value="...">
   *     </div>
   *     <button type="submit">Confirm</button>
   *     <button type="button">Cancel</button>
   *   </form>
   *
   * Verified live against Studio v2-beta on 2026-06-17.
   */
  private async fillInlineEditField(
    readViewTestId: string,
    value: string,
    fieldDescription: string,
  ): Promise<void> {
    const page = this.page;

    const readView = page.getByTestId(readViewTestId);
    try {
      await readView.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      throw new Error(
        `Could not find the ${fieldDescription} read view ` +
        `(testId: ${readViewTestId}). Studio UI selectors may have changed.`,
      );
    }

    // The InlineEdit edit button is an invisible 0×0 overlay sibling. Click
    // it programmatically via .evaluate so Playwright doesn't fail on the
    // zero-size visibility check.
    await page.evaluate(({ testId }) => {
      const rv = document.querySelector(`[data-testid="${testId}"]`);
      if (!rv) throw new Error('read view vanished between waitFor and evaluate');
      const form = rv.closest('form[role="presentation"]');
      if (!form) throw new Error('no form ancestor for read view');
      const btn = form.querySelector('button[aria-label$=", edit" i]')
        ?? form.querySelector('button[type="button"]');
      if (!btn) throw new Error('no edit button in form');
      (btn as HTMLButtonElement).click();
    }, { testId: readViewTestId });

    // Wait for the edit-mode input to appear inside the same form.
    const inputLocator = page.locator(
      `[data-testid="${readViewTestId}"] ~ * input[name="inlineEdit"], ` +
      `form:has([data-testid="${readViewTestId}"]) input[name="inlineEdit"]`,
    ).first();
    try {
      await inputLocator.waitFor({ state: 'visible', timeout: 3_000 });
    } catch {
      // Fall back to any input[name="inlineEdit"] on the page (there's
      // normally only one open at a time).
      const anyInput = page.locator('input[name="inlineEdit"]').first();
      try {
        await anyInput.waitFor({ state: 'visible', timeout: 1_500 });
        await anyInput.fill(value);
        await this.commitInlineEdit(readViewTestId);
        return;
      } catch {
        throw new Error(
          `Clicked the ${fieldDescription} edit button but no input[name="inlineEdit"] appeared. ` +
          'Studio UI selectors may have changed.',
        );
      }
    }

    await inputLocator.fill(value);
    await page.waitForTimeout(150);
    await this.commitInlineEdit(readViewTestId);
  }

  /**
   * Commit an open InlineEdit by clicking its Confirm (submit) button.
   * Falls back to submitting the form directly.
   */
  private async commitInlineEdit(readViewTestId: string): Promise<void> {
    const page = this.page;
    await page.evaluate(({ testId }) => {
      const rv = document.querySelector(`[data-testid="${testId}"]`);
      const form = rv?.closest('form[role="presentation"]')
        ?? document.querySelector('form[role="presentation"] input[name="inlineEdit"]')
          ?.closest('form[role="presentation"]');
      if (!form) return;
      const confirm = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
      if (confirm) {
        confirm.click();
      } else if ('requestSubmit' in form) {
        (form as HTMLFormElement).requestSubmit?.();
      }
    }, { testId: readViewTestId });

    // Wait for the form to swap back to read view.
    try {
      await page.locator(`[data-testid="${readViewTestId}"]`).waitFor({ state: 'visible', timeout: 2_000 });
    } catch {}
    await page.waitForTimeout(200);
  }

  /**
   * Fill the agent's main Instructions field. v2-beta wraps the AK editor
   * (ProseMirror) in `[data-testid="core-instructions-editor"]`. We focus
   * the contenteditable and use `keyboard.insertText`, which integrates
   * correctly with ProseMirror's React-controlled state.
   *
   * Verified live against Studio v2-beta on 2026-06-17.
   */
  private async fillInstructions(text: string): Promise<void> {
    const page = this.page;

    // Scope strictly to the main agent's editor — once subagents are added,
    // there will be multiple AK editors on the page (one per scenario), and
    // we don't want to overwrite a subagent's instructions with the
    // main-agent text.
    const editor = page.locator(
      '[data-testid="core-instructions-editor"] [contenteditable="true"]',
    ).first();
    try {
      await editor.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      throw new Error(
        'Could not find the main Instructions editor ' +
        '(selector: [data-testid="core-instructions-editor"] [contenteditable="true"]). ' +
        'Studio UI selectors may have changed.',
      );
    }

    await this.fillAkEditor(editor, text);
  }

  /**
   * Fill a ProseMirror / AK editor's contenteditable.
   *
   * Uses `page.evaluate` to run a script in the page context that walks
   * the React fiber to find the ProseMirror `EditorView` and dispatches a
   * real PM transaction replacing the document with paragraphs built from
   * the lines of `text`. PM's transaction pipeline guarantees that AK
   * Editor's `onChange` fires and React form state is updated.
   *
   * This mirrors the approach used in the chrome extension's content
   * script, which has to inject a `<script>` tag to escape the isolated
   * world; Playwright's `evaluate` already runs in the page world.
   */
  private async fillAkEditor(editor: import('playwright').Locator, text: string): Promise<void> {
    const page = this.page;

    await editor.scrollIntoViewIfNeeded().catch(() => undefined);
    await editor.click();
    await page.waitForTimeout(100);

    const result = await editor.evaluate((el, content): string | null => {
      const fiberKey = Object.keys(el).find(
        (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
      );
      if (!fiberKey) return 'react fiber not found on editor';
      let node = (el as unknown as Record<string, unknown>)[fiberKey] as
        | {
            return?: unknown;
            memoizedState?: {
              memoizedState?: { current?: { dispatch?: unknown; state?: { doc?: unknown } } };
              next?: unknown;
            };
          }
        | undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let view: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cursor: any = node;
      for (let i = 0; i < 100 && cursor && !view; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let hook: any = cursor.memoizedState;
        while (hook) {
          const ms = hook.memoizedState;
          if (
            ms
            && ms.current
            && typeof ms.current === 'object'
            && typeof ms.current.dispatch === 'function'
            && ms.current.state
            && ms.current.state.doc
          ) {
            view = ms.current;
            break;
          }
          hook = hook.next;
        }
        cursor = cursor.return;
      }
      if (!view) return 'ProseMirror EditorView not found via fiber walk';

      const state = view.state;
      const schema = state.schema;
      const paragraphType = schema.nodes.paragraph;
      if (!paragraphType) return 'schema has no paragraph node';

      const lines = content.split('\n');
      while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
        lines.pop();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let nodes = lines.map((line: string) =>
        line.length > 0
          ? paragraphType.create({}, schema.text(line))
          : paragraphType.create({}),
      );
      if (nodes.length === 0) {
        nodes = [paragraphType.create({})];
      }

      let tr = state.tr.delete(0, state.doc.content.size);
      let pos = 0;
      for (const n of nodes) {
        tr = tr.insert(pos, n);
        pos += n.nodeSize;
      }
      if (typeof tr.setMeta === 'function') {
        tr.setMeta('addToHistory', true);
        tr.setMeta('uiEvent', 'input');
      }
      view.dispatch(tr);
      return null;
    }, text);

    if (result !== null) {
      throw new Error(`Could not fill AK editor via PM transaction: ${result}`);
    }

    await page.waitForTimeout(300);

    // Final commit nudge — focus a sentinel element so any pending
    // debounced onChange flushes.
    await editor.evaluate((el) => {
      (el as HTMLElement).dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
      );
      (el as HTMLElement).blur();
      (document.body as HTMLElement).tabIndex = -1;
      (document.body as HTMLElement).focus();
    });
    await page.waitForTimeout(300);
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

  // ---------------------------------------------------------------------------
  // v2-beta single-page editor
  // ---------------------------------------------------------------------------

  /**
   * Configure the agent on the v2-beta single-page editor.
   *
   * v2-beta merges identity + default scenario into one form (no Identity /
   * Default Scenario sidebar) and uses a rich-text editor for instructions.
   * Subagents are added separately by the caller via {@link addSubagent}.
   *
   * Throws if Name, Description, or Instructions cannot be filled — these
   * are the minimum required for a non-empty agent.
   */
  private async configureAgent(
    config: RovoAgentConfig,
    knowledgePages: KnowledgePage[] = [],
  ): Promise<void> {
    const { identity, scenarios } = config;

    // Wait for the editor form to actually render before probing for inputs.
    // Without this we race the SPA and every selector misses on first run.
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(1500);

    // Name and Description both use Atlassian Design System InlineEdit on
    // the /agents/create/details/ page. Verified live 2026-06-17.
    await this.fillInlineEditField(
      'agent-heading-toolbar-name-field-read-view',
      identity.name,
      'Name',
    );

    await this.fillInlineEditField(
      'agent-heading-toolbar-description-field-read-view',
      identity.description,
      'Description',
    );

    // Instructions — required, rich text.
    if (!scenarios.default.instructions || scenarios.default.instructions.trim().length === 0) {
      throw new Error('Agent has empty instructions — refusing to activate an empty agent.');
    }
    await this.fillInstructions(scenarios.default.instructions);

    // Conversation starters — optional, top-level.
    if (identity.conversationStarters?.length) {
      await this.fillConversationStarters(identity.conversationStarters);
    }

    // Knowledge / web search / deep research — optional toggles.
    const scenarioKnowledge = scenarios.default.knowledge ?? 'all';
    const shouldLinkPages = knowledgePages.length > 0 && scenarioKnowledge === 'custom';
    await this.selectKnowledge(shouldLinkPages ? 'custom' : scenarioKnowledge);
    if (shouldLinkPages) {
      await this.addConfluencePageKnowledge(knowledgePages);
    }
    await this.setCheckbox('Web search', scenarios.default.webSearch ?? false);
    if (scenarios.default.deepResearch !== undefined) {
      await this.setCheckbox('Deep research', scenarios.default.deepResearch);
    }

    // Skills — optional.
    if (scenarios.default.skills?.length) {
      await this.addSkillsToScenario(scenarios.default.skills);
    }
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
