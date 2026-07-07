/**
 * Rovo Agent Provisioner — DOM-based port of the Playwright RovoProvisioner.
 *
 * Runs inside a Studio content script. Only `rovo.atlassian.com/v2-beta`
 * agents are supported (v1 is archived).
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
  RovoCustomScenario,
} from './types.js';

export type ProgressCallback = (message: string, step: number, total: number) => void;

export async function provisionAgent(
  config: RovoAgentConfig,
  onProgress: ProgressCallback,
): Promise<void> {
  const subagentCount = config.scenarios.custom?.length ?? 0;
  // Steps: create + configure + N subagents + activate + publish.
  const totalSteps = 4 + subagentCount;

  // Verify the page-world helper is loaded before we start. Filling any
  // React-controlled input (name, instructions, subagents, ...) requires
  // it — the isolated content-script world cannot bypass React's
  // `_valueTracker` or dispatch a ProseMirror transaction.
  await ensurePageWorldReady();

  onProgress('Creating agent...', 1, totalSteps);
  await createNewAgent();

  onProgress('Configuring agent...', 2, totalSteps);
  await configureAgent(config);

  if (config.scenarios.custom?.length) {
    for (let i = 0; i < config.scenarios.custom.length; i++) {
      const subagent = config.scenarios.custom[i];
      onProgress(`Adding subagent: ${subagent.name}...`, 3 + i, totalSteps);
      await addSubagent(subagent);
    }
  }

  // Activate the agent (first-time activation — saves the initial draft).
  onProgress('Activating agent...', totalSteps - 1, totalSteps);
  await activateAgent();

  // Publish so the per-field autosaves + our publish-time patch land
  // server-side. The Publish click triggers `mutations_publishAgentVersionMutation`,
  // which our fetch hook in page-world/inject.ts intercepts to fire the
  // patched mutations_agentMutation + per-subagent scenario patches.
  onProgress('Publishing agent...', totalSteps, totalSteps);
  await publishAgent();
  onProgress('Agent published successfully!', totalSteps, totalSteps);
}

async function createNewAgent(): Promise<void> {
  await waitForTimeout(2000);

  await tryWithFallback(
    async () => {
      const btn = await waitForSelector('[data-testid="create-agent-button-trigger"]');
      click(btn);
    },
    async () => {
      const btn = await waitForElement(
        () => getByRole('button', { name: /Create an agent/i }),
        '"Create an agent" button',
      );
      click(btn);
    },
  );
  await waitForTimeout(1000);

  await tryWithFallback(
    async () => {
      const item = await waitForSelector('[data-testid="create-rovo-agent-menu-item"]');
      click(item);
    },
    async () => {
      const item = await waitForElement(
        () => getByRole('menuitem', { name: /Rovo agent/i }),
        '"Rovo agent" menu item',
      );
      click(item);
    },
  );
  await waitForTimeout(2000);

  // After clicking "Rovo agent" we land on the "Describe your agent"
  // natural-language create page. We MUST escape it to reach the manual
  // editor with Name/Description inputs. v1 called this "Skip to manual
  // setup"; v2-beta may use different copy. Try several variants; only
  // swallow if none of them match.
  //
  // The SPA transition from the menu click to the NL create page is
  // network-bound, so we poll for the button to appear instead of doing
  // a one-shot scan after a fixed timeout. Otherwise on slow networks
  // the synchronous lookup misses the button before it renders and the
  // flow throws "Could not find a way to skip to manual setup" — or
  // configureAgent is reached before the agent editor exists and step 2
  // fails with "Could not find the Name read view".
  const manualSetupLabels = [
    /Skip to manual setup/i,
    /Manual setup/i,
    /Create manually/i,
    /Start from scratch/i,
    /Set up manually/i,
    /^Skip$/i,
  ];
  const manualSetupTestIds = [
    'nl-create-skip-to-manual-setup-button',
    'create-skip-to-manual-setup-button',
    'manual-setup-button',
    'skip-to-manual-setup',
  ];

  const findManualSetupButton = (): HTMLElement | null => {
    for (const testId of manualSetupTestIds) {
      const btn = getByTestId(testId);
      if (btn) return btn;
    }
    for (const label of manualSetupLabels) {
      const btn = getByRole('button', { name: label });
      if (btn) return btn;
      const link = getByRole('link', { name: label });
      if (link) return link;
    }
    return null;
  };

  let manualSetupBtn: HTMLElement;
  try {
    manualSetupBtn = await waitForElement(
      findManualSetupButton,
      '"Skip to manual setup" button (tried test-ids: ' +
        manualSetupTestIds.join(', ') +
        ')',
      15_000,
    );
  } catch {
    throw new Error(
      'Could not find a way to skip to manual setup after 15s. The natural-language ' +
      'create page is open but none of the known button labels matched. Studio UI ' +
      'selectors may have changed.',
    );
  }
  // Studio's NL create page uses an AK/Pragmatic button whose navigation
  // handler is bound through React in a way that `element.click()` and
  // synthesised pointer events don't reach. Route through the page-world
  // bridge to invoke onClick on the fiber directly. See pageWorldClickReact
  // and the `clickReact` op in src/page-world/inject.ts for the full
  // explanation.
  manualSetupBtn.scrollIntoView({ block: 'center' });
  try {
    await pageWorldClickReact(manualSetupBtn);
  } catch (e) {
    // Fall back to the regular click path — if Studio reverts to a
    // button that does respond to `.click()`, we don't want to fail.
    const reason = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.warn(
      '[rovo] pageWorldClickReact failed for Skip-to-manual-setup (' + reason + '); ' +
      'falling back to element.click().',
    );
    click(manualSetupBtn);
  }

  // Wait for the agent editor to actually mount (Name InlineEdit appears)
  // instead of a fixed delay. Studio's SPA can take several seconds on
  // a cold start to swap from the NL create page to the editor.
  try {
    await waitForSelector(
      '[data-testid="agent-heading-toolbar-name-field-read-view"]',
      20_000,
    );
  } catch {
    throw new Error(
      'Clicked "Skip to manual setup" but the agent editor did not render within 20s ' +
      '(waiting for data-testid="agent-heading-toolbar-name-field-read-view"). ' +
      'The page may be slow to load — try again, or check that Studio finished navigating ' +
      'to the agent editor.',
    );
  }
}

async function configureAgent(config: RovoAgentConfig): Promise<void> {
  const { identity, scenarios } = config;
  const defaultScenario = scenarios.default;

  // `createNewAgent` already waits for the Name read view to appear, but
  // give the rest of the editor form a brief moment to settle (the
  // Description field and Instructions editor render slightly after the
  // toolbar). `fillInlineEditField` polls on its own as a final safety
  // net so this is just to reduce churn on the first call.
  await waitForTimeout(500);

  // Fill Name and Description in UI so page-world script can read them
  // from DOM when patching the mutation.
  await fillInlineEditField('agent-heading-toolbar-name-field-read-view', identity.name, 'Name');
  await waitForTimeout(300);

  await fillInlineEditField(
    'agent-heading-toolbar-description-field-read-view',
    identity.description,
    'Description',
  );
  await waitForTimeout(300);

  if (!defaultScenario.instructions || defaultScenario.instructions.trim().length === 0) {
    throw new Error('Agent has empty instructions — refusing to activate an empty agent.');
  }
  await fillInstructions(defaultScenario.instructions);
  await waitForTimeout(500);

  if (identity.conversationStarters?.length) {
    await fillConversationStarters(identity.conversationStarters);
  }

  await selectKnowledge(defaultScenario.knowledge ?? 'all');
  await setCheckbox('Web search', defaultScenario.webSearch ?? false);
  if (defaultScenario.deepResearch !== undefined) {
    await setCheckbox('Deep research', defaultScenario.deepResearch);
  }

  if (defaultScenario.skills?.length) {
    await addSkillsToScenario(defaultScenario.skills);
  }
}

async function addSubagent(subagent: RovoCustomScenario): Promise<void> {
  // Count existing subagents BEFORE adding so we can identify the new one.
  const existingCount = document.querySelectorAll('input[aria-label="Scenario name"]').length;

  // Snapshot scenarioIds that the page-world has already seen in GraphQL
  // responses BEFORE clicking Add. After the click, the newEmptyScenarioMutation
  // response will append a new ARI to the list, and we'll grab it as
  // this subagent's id.
  const scenarioIdsBefore = new Set(await pageWorldGetScenarioIds());

  const addBtn = await waitForElement(
    () => getByRole('button', { name: /Add new scenario|Add subagent/i }),
    '"Add new scenario" button',
  );
  click(addBtn);

  // Wait for the new Scenario name input to appear.
  const deadline = Date.now() + 5_000;
  let nameInput: HTMLInputElement | null = null;
  while (Date.now() < deadline) {
    const inputs = document.querySelectorAll<HTMLInputElement>('input[aria-label="Scenario name"]');
    if (inputs.length > existingCount) {
      nameInput = inputs[inputs.length - 1];
      break;
    }
    await waitForTimeout(150);
  }
  if (!nameInput) {
    throw new Error(
      `Could not locate the new Scenario name input after clicking "Add subagent" for "${subagent.name}".`,
    );
  }

  // Poll for the new scenarioId to appear in captured responses. The
  // newEmptyScenarioMutation response usually lands within a second of
  // the Add click, but we give it 7s to cover slow networks. If it never
  // appears the publish-time patch will skip this subagent (logged), and
  // the user can still see the name/instructions we filled in the UI.
  let newScenarioId: string | null = null;
  const idDeadline = Date.now() + 7_000;
  while (Date.now() < idDeadline) {
    const current = await pageWorldGetScenarioIds();
    const candidate = current.find((id) => !scenarioIdsBefore.has(id));
    if (candidate) { newScenarioId = candidate; break; }
    await waitForTimeout(200);
  }

  // Stash desired values + the freshly-captured scenarioId on the
  // subagent's container. Read at publish time by
  // `firePatchedScenarioMutations` in page-world/inject.ts.
  stashSubagentDataAttrs(nameInput, subagent, newScenarioId);

  // Fill name in the UI so the user sees the desired value before
  // publish. The scenarioNameField autosave may or may not fire from
  // a programmatic onChange in current Studio builds — doesn't matter,
  // the publish-time patch (firePatchedScenarioMutations) writes name
  // regardless. Worst case the UI shows the value but the autosave is
  // missed, and the patch picks it up.
  await pageWorldFillInput(nameInput, subagent.name);
  await waitForTimeout(200);

  if (subagent.trigger) {
    const triggerTextarea = findFollowingTextarea(nameInput);
    if (triggerTextarea) {
      await pageWorldFillInput(triggerTextarea, subagent.trigger);
      await waitForTimeout(200);
    }
  }

  // Fill instructions in the UI so the user sees them too. AK Editor's
  // instructions-autosave plugin doesn't fire from a programmatic PM
  // transaction in current Studio builds, but the publish-time patch
  // takes care of persisting. Wrapped in try/catch because the editor
  // may remount mid-dispatch on slow renders — the patch path is the
  // source of truth either way.
  if (subagent.instructions && subagent.instructions.length > 0) {
    const instructionsEditor = findSubagentInstructionsEditor(nameInput);
    if (instructionsEditor) {
      try {
        await fillAkEditor(instructionsEditor, subagent.instructions);
      } catch (e) {
        // Visible fill is best-effort — patch path still works.
        // eslint-disable-next-line no-console
        console.warn(
          '[rovo] Subagent instructions UI fill failed for "' + subagent.name + '" ' +
          '(non-fatal, publish-time patch will save it):',
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  await selectKnowledge(subagent.knowledge ?? 'all');
  await setCheckbox('Web search', subagent.webSearch ?? false);
  if (subagent.deepResearch !== undefined) {
    await setCheckbox('Deep research', subagent.deepResearch);
  }

  if (subagent.skills?.length) {
    await addSkillsToScenario(subagent.skills, existingCount + 1);
  }

  // Subagents are added in a disabled state — Studio shows them as
  // collapsed "Untitled" rows with the toggle off. Flipping the toggle
  // marks the subagent as enabled so the agent actually uses it.
  await enableSubagentToggle(nameInput, subagent.name);
}

/**
 * Stash the subagent's desired name + instructions + freshly-captured
 * scenarioId on the `nameInput` element itself.
 *
 * Why on the input and not on a "container": walking up to find an
 * ancestor that contains a `[role="switch"]` is unreliable once there
 * are multiple subagents — several siblings share a higher ancestor
 * that already contains earlier subagents' switches, so the walk stops
 * on that SHARED ancestor and the stamps overwrite each other. With two
 * subagents we ended up with only one DOM element carrying any of the
 * data-attrs, and only that one got patched on publish.
 *
 * The `nameInput` is guaranteed unique per subagent (each subagent has
 * exactly one `input[aria-label="Scenario name"]`), so stamping there
 * is the simplest correct anchor. The publish-time patcher in
 * `page-world/inject.ts` just queries `[data-rovo-scenario-id]` and
 * doesn't care what kind of element carries the attribute.
 */
function stashSubagentDataAttrs(
  nameInput: HTMLInputElement,
  subagent: RovoCustomScenario,
  scenarioId: string | null,
): void {
  if (scenarioId) {
    nameInput.setAttribute('data-rovo-scenario-id', scenarioId);
  }
  if (subagent.name) {
    nameInput.setAttribute('data-rovo-scenario-name', subagent.name);
  }
  if (subagent.instructions) {
    nameInput.setAttribute('data-rovo-scenario-instructions', subagent.instructions);
  }
  if (subagent.trigger) {
    nameInput.setAttribute('data-rovo-scenario-trigger', subagent.trigger);
  }
}

/**
 * Find and enable the toggle switch for a subagent that was just
 * configured. Walks up from the Scenario name input to find the
 * subagent's container, then flips the first `[role="switch"]` if it's
 * currently `aria-checked="false"`.
 *
 * Failures are non-fatal — provisioning has already populated the
 * subagent's content; the worst case is the user has to flip the toggle
 * manually.
 */
async function enableSubagentToggle(
  nameInput: HTMLInputElement,
  subagentName: string,
): Promise<void> {
  // Walk up to a container that hosts the subagent's toggle. Subagent
  // containers in v2-beta hold the name input, the trigger textarea, the
  // instructions editor, AND the enable toggle. Walk up to ~10 levels to
  // find the smallest ancestor that contains a `[role="switch"]`.
  let container: HTMLElement | null = nameInput;
  for (let i = 0; i < 12 && container; i++) {
    if (container.querySelector('[role="switch"]')) break;
    container = container.parentElement;
  }
  if (!container) {
    void subagentName; // referenced for future logging hooks
    return;
  }
  const toggle = container.querySelector<HTMLElement>('[role="switch"]');
  if (!toggle) return;
  if (toggle.getAttribute('aria-checked') === 'true') return;
  click(toggle);
  await waitForTimeout(400);
}

/**
 * Find the first <textarea> that appears AFTER a given element in document
 * order. Used to locate a subagent's Trigger textarea given its Scenario
 * name input.
 */
function findFollowingTextarea(after: HTMLElement): HTMLTextAreaElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>('textarea, input[aria-label="Scenario name"]'));
  const idx = all.indexOf(after);
  if (idx === -1) return null;
  for (let i = idx + 1; i < all.length; i++) {
    const el = all[i];
    if (el.tagName === 'TEXTAREA') return el as HTMLTextAreaElement;
    // Hit the next subagent's name input — stop, no trigger for this one.
    if (el.getAttribute('aria-label') === 'Scenario name') return null;
  }
  return null;
}

/**
 * Find the AK editor (contenteditable) that belongs to a subagent given
 * its Scenario name input. The editor is the first contenteditable AFTER
 * the name input in document order (and BEFORE the next subagent's name
 * input, if any).
 */
function findSubagentInstructionsEditor(after: HTMLElement): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(
    'input[aria-label="Scenario name"], [contenteditable="true"]',
  ));
  const idx = all.indexOf(after);
  if (idx === -1) return null;
  for (let i = idx + 1; i < all.length; i++) {
    const el = all[i];
    if (el.getAttribute('contenteditable') === 'true') {
      // Skip the main agent's instructions editor (won't normally appear
      // after a subagent name input, but guard anyway).
      if (el.closest('[data-testid="core-instructions-editor"]')) continue;
      return el;
    }
    if (el.getAttribute('aria-label') === 'Scenario name') return null;
  }
  return null;
}

/**
 * Fill an Atlassian Design System InlineEdit field. Used for both Name and
 * Description in v2-beta Studio.
 *
 * The DOM looks like:
 *   <form role="presentation">
 *     <div>
 *       <div>
 *         <button aria-label="{value}, edit">  ← invisible 0×0 overlay button
 *         <div role="presentation">
 *           <... data-testid="{readViewTestId}">{value or placeholder}</...>
 *         </div>
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
async function fillInlineEditField(
  readViewTestId: string,
  value: string,
  fieldDescription: string,
): Promise<void> {
  // Poll for the read view to appear. The Description heading in
  // particular can render a beat after the Name heading on slow page
  // loads, so a one-shot lookup races the SPA.
  let readView: HTMLElement;
  try {
    readView = await waitForElement(
      () => getByTestId(readViewTestId),
      `${fieldDescription} read view (testId: ${readViewTestId})`,
      15_000,
    );
  } catch {
    throw new Error(
      `Could not find the ${fieldDescription} read view (testId: ${readViewTestId}) ` +
      'after 15s. The agent editor may not have finished loading, or Studio UI ' +
      'selectors may have changed.',
    );
  }

  // Find the form ancestor that owns this read view.
  const form = readView.closest('form[role="presentation"]') as HTMLFormElement | null;
  if (!form) {
    throw new Error(
      `Could not find the form ancestor for ${fieldDescription} (testId: ${readViewTestId}). ` +
      'Studio UI selectors may have changed.',
    );
  }

  // Click the InlineEdit edit button (it's a sibling of the read view's
  // wrapper, inside the form). The button is 0×0 (an absolutely-positioned
  // overlay) so `getBoundingClientRect()` returns zero — but a programmatic
  // `.click()` still triggers the React handler.
  const editButton = form.querySelector<HTMLElement>('button[aria-label$=", edit" i]')
    ?? form.querySelector<HTMLElement>('button[type="button"]');
  if (!editButton) {
    throw new Error(
      `Could not find the ${fieldDescription} InlineEdit button. ` +
      'Studio UI selectors may have changed.',
    );
  }
  editButton.click();

  // Poll for the edit-mode input to appear inside the same form. AK's
  // React swap can take a few hundred ms.
  let input: HTMLInputElement | null = null;
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    input = form.querySelector<HTMLInputElement>(
      'input[data-ds--text-field--input="true"][name="inlineEdit"]',
    ) ?? form.querySelector<HTMLInputElement>('input[name="inlineEdit"]');
    if (input) break;
    await waitForTimeout(100);
  }

  if (!input) {
    throw new Error(
      `Clicked the ${fieldDescription} edit button but no input[name="inlineEdit"] appeared. ` +
      'Studio UI selectors may have changed.',
    );
  }

  // Route through the page-world bridge so React's controlled-input
  // tracker actually fires onChange. See `pageWorldFillInput` for why.
  await pageWorldFillInput(input, value);
  await waitForTimeout(150);

  // Commit by clicking the form's submit button (the "Confirm" check icon).
  const confirmButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (confirmButton) {
    confirmButton.click();
  } else {
    // Fallback — submit the form directly.
    form.requestSubmit?.();
  }

  // Wait for the form to swap back to read view.
  const swapDeadline = Date.now() + 2_000;
  while (Date.now() < swapDeadline) {
    if (!form.querySelector('input[name="inlineEdit"]')) break;
    await waitForTimeout(100);
  }
  await waitForTimeout(200);
}

/**
 * Fill the agent's main Instructions field. v2-beta wraps the AK editor
 * (ProseMirror) in `[data-testid="core-instructions-editor"]`. Filling
 * is done by injecting a script into the page's main world that
 * dispatches a real ProseMirror transaction — see `fillAkEditor` below
 * for why.
 *
 * Verified live against Studio v2-beta on 2026-06-17.
 */
async function fillInstructions(text: string): Promise<void> {
  // Scope strictly to the main agent's editor — once subagents are added,
  // there will be multiple AK editors on the page (one per scenario), and
  // we don't want to overwrite a subagent's instructions with the
  // main-agent text.
  const editor = document.querySelector<HTMLElement>(
    '[data-testid="core-instructions-editor"] [contenteditable="true"]',
  );
  if (!editor) {
    throw new Error(
      'Could not find the main Instructions editor ' +
      '(selector: [data-testid="core-instructions-editor"] [contenteditable="true"]). ' +
      'Studio UI selectors may have changed.',
    );
  }

  await fillAkEditor(editor, text);
}

/**
 * Fill a ProseMirror / AK editor's contenteditable.
 *
 * IMPORTANT — why this is so convoluted:
 *
 * Chrome MV3 content scripts run in an **isolated JS world**, separate
 * from the page's main world. Page-script expandos like `__reactFiber*`,
 * `__reactProps$*`, `pmViewDesc`, and ProseMirror's `EditorView` are
 * stored on the page-world wrapper of each DOM element and are NOT
 * visible from the content script. We can't just walk the React fiber
 * and call `view.dispatch()` directly.
 *
 * `document.execCommand('insertText')` does update the visible DOM (and
 * fires trusted `input` events), but in practice this does NOT reliably
 * propagate into AK Editor's React-Hook-Form state in many environments —
 * the editor visibly contains the text, but the form state stays empty,
 * so when the user clicks Activate the GraphQL `createAgent` mutation
 * sends `instructions: ""` and the agent is saved with no instructions.
 *
 * The reliable fix is to inject a `<script>` tag that runs in the page's
 * **main world**, walks the React fiber to find the ProseMirror
 * `EditorView`, and dispatches a real PM transaction that sets the
 * document content. PM's transaction pipeline guarantees that AK
 * Editor's `onChange` fires and React form state is updated.
 *
 * We communicate completion back via `window.postMessage`, which IS
 * cross-world.
 */
async function fillAkEditor(editor: HTMLElement, text: string): Promise<void> {
  // Make sure the editor is in view. Some flows require this for focus
  // and trusted input event delivery.
  try {
    editor.scrollIntoView({ block: 'center' });
  } catch {
    /* noop */
  }
  editor.focus();
  await waitForTimeout(100);

  // Use a stable test-id on the wrapper so the page-world script can
  // re-locate the editor. The main agent uses `core-instructions-editor`;
  // for subagents we tag the editor with a unique data attribute first.
  const wrapper =
    editor.closest<HTMLElement>('[data-testid="core-instructions-editor"]') ?? editor;
  let locatorAttr = '';
  let locatorValue = '';
  if (wrapper.getAttribute('data-testid') === 'core-instructions-editor') {
    locatorAttr = 'data-testid';
    locatorValue = 'core-instructions-editor';
  } else {
    // Tag this specific editor with a unique attribute we can find from
    // the page world. Subagent editors don't carry a stable testid.
    locatorAttr = 'data-rovo-fill-target';
    locatorValue = 'rovo-fill-' + Math.random().toString(36).slice(2);
    editor.setAttribute(locatorAttr, locatorValue);
  }

  let result: unknown;
  try {
    result = await pageWorldRequest({
      op: 'fillAkEditor',
      selector: '[' + locatorAttr + '=' + JSON.stringify(locatorValue) + ']',
      text,
    });
  } finally {
    if (locatorAttr === 'data-rovo-fill-target') {
      editor.removeAttribute(locatorAttr);
    }
  }

  // AK Editor updates its react-hook-form value via plugins observing
  // ProseMirror transactions. The page-world script dispatches a real
  // transaction directly (via the EditorView), so the form state is
  // updated synchronously — but plugins may flush async, so wait a bit.
  await waitForTimeout(800);

  // Verify content via the page-world's own readout of PM's doc state
  // and the live DOM. We can't trust `editor.textContent` from this
  // (isolated) world because AK Editor sometimes replaces the
  // contenteditable node during the dispatch — our `editor` reference
  // would then point to an orphaned, empty DOM node.
  const firstLine = text.split('\n').find((line) => line.trim().length > 0) ?? '';
  const needle = firstLine.trim().slice(0, 30);
  const data = (result ?? {}) as { docText?: unknown; domText?: unknown; reFound?: unknown };
  const docText = typeof data.docText === 'string' ? data.docText : '';
  const domText = typeof data.domText === 'string' ? data.domText : '';

  if (needle.length > 0 && !docText.includes(needle) && !domText.includes(needle)) {
    throw new Error(
      'Filled the AK editor but PM\'s post-dispatch doc does not include the new text. ' +
      'PM dispatch may have hit a stale/wrong view. ' +
      'docText: "' + docText.slice(0, 80) + '" | ' +
      'liveDomText: "' + domText.slice(0, 80) + '" | ' +
      'reFoundEditor: ' + String((data as { reFound?: unknown }).reFound),
    );
  }
}

/**
 * Fill an `<input>` or `<textarea>` via the page-world bridge.
 *
 * Even a "plain" React-controlled input cannot be filled reliably from
 * the isolated content-script world: the standard "native value setter"
 * trick (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,
 * 'value').set`) resolves to the ISOLATED world's prototype setter, not
 * the page world's. React's `_valueTracker` was captured against the
 * page-world setter, so calling the isolated-world setter does NOT
 * bypass the tracker, the resulting `input` event is treated as a
 * no-op, and React form state stays empty.
 *
 * This was the root cause of subagent names saving as "Untitled" even
 * though the visible DOM showed the correct name.
 *
 * The fix is to delegate the value setter call to a script running in
 * the page world (see `src/page-world/inject.ts`).
 */
async function pageWorldFillInput(el: HTMLElement, text: string): Promise<void> {
  const attr = 'data-rovo-fill-target';
  const value = 'rovo-fill-' + Math.random().toString(36).slice(2);
  el.setAttribute(attr, value);
  try {
    await pageWorldRequest({
      op: 'fillNative',
      selector: '[' + attr + '=' + JSON.stringify(value) + ']',
      text,
    });
  } finally {
    el.removeAttribute(attr);
  }
}

/**
 * Click a button by invoking its React `onClick` handler(s) via the
 * page-world bridge. Use this only for buttons where `element.click()`
 * doesn't fire the navigation/action handler.
 *
 * Background: Studio's natural-language create page uses an AK button
 * whose handler is bound through React in a way that synthetic clicks
 * from MV3 content scripts don't reach. Pointer events also fail.
 * Walking the fiber and calling onClick directly DOES work (verified
 * live in DevTools). See `clickReact` in `src/page-world/inject.ts`.
 *
 * Don't use this as the default click path — the normal `click()` helper
 * works for every other button in the flow, and clickReact bypasses the
 * full DOM event sequence (no pointer events, no focus shift). Reserve
 * it for buttons that are known not to respond to `.click()`.
 */
async function pageWorldClickReact(el: HTMLElement): Promise<void> {
  const attr = 'data-rovo-click-target';
  const value = 'rovo-click-' + Math.random().toString(36).slice(2);
  el.setAttribute(attr, value);
  try {
    await pageWorldRequest({
      op: 'clickReact',
      selector: '[' + attr + '=' + JSON.stringify(value) + ']',
    });
  } finally {
    el.removeAttribute(attr);
  }
}

/**
 * Read the page-world's insertion-ordered list of distinct scenario
 * ARIs seen in any GraphQL response body. Used by `addSubagent` to
 * snapshot before the "Add new scenario" click, then poll afterwards
 * for the newly-created scenario's id (which arrives in the
 * `newEmptyScenarioMutation` response within ~1s on a normal network).
 *
 * The whole point: deterministic mapping between a newly-added subagent
 * UI container and its server-side scenarioId. No DOM-order guessing,
 * no autosave-template chasing.
 */
async function pageWorldGetScenarioIds(): Promise<string[]> {
  try {
    const result = await pageWorldRequest({ op: 'getScenarioIds' }, 1_500);
    const ids = (result as { ids?: unknown })?.ids;
    if (!Array.isArray(ids)) return [];
    return ids.filter((x): x is string => typeof x === 'string');
  } catch {
    // If the page-world isn't responsive (shouldn't happen after
    // ensurePageWorldReady), return empty so the caller falls back
    // gracefully — the publish-time patcher will skip subagents whose
    // container has no data-rovo-scenario-id.
    return [];
  }
}

// Must match PAGE_WORLD_VERSION in src/page-world/inject.ts.
const REQUIRED_PAGE_WORLD_VERSION = 22;

/**
 * Verify the page-world content script (registered with `"world": "MAIN"`
 * in `manifest.json`, source at `src/page-world/inject.ts`) has loaded,
 * is responding to messages, and is the correct version.
 *
 * Version mismatches happen when the extension is reloaded without
 * reloading the Studio tab: the old inject.js (registered at page-load
 * time) keeps running due to the idempotency guard, so ping succeeds
 * but the fill handlers are the old broken ones. Fail fast with a clear
 * "reload this tab" message instead of silently saving empty data.
 */
async function ensurePageWorldReady(): Promise<void> {
  let pingData: unknown;
  try {
    pingData = await pageWorldRequest({ op: 'ping' }, 1_500);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      'Page-world helper not responding (' + reason + '). The extension\'s ' +
      'main-world content script (page-world/inject.js) did not load. ' +
      'Reload the Studio tab; if that does not help, reinstall the extension ' +
      'and confirm chrome://extensions shows it as enabled.',
    );
  }
  const version = (pingData as { version?: unknown })?.version;
  if (version !== REQUIRED_PAGE_WORLD_VERSION) {
    throw new Error(
      'Page-world script is version ' + String(version) + ' but version ' +
      REQUIRED_PAGE_WORLD_VERSION + ' is required. ' +
      'Reload this Studio tab after reloading the extension, then retry.',
    );
  }
}

/**
 * Send a request to the page-world content script and await its
 * response. The bridge is `window.postMessage` because that's the only
 * channel that crosses the isolated/main JS world boundary.
 *
 * Inline `<script>` tag injection used to be the standard workaround,
 * but on Studio it's blocked silently by the document's Trusted Types
 * policy. Declaring the helper with `"world": "MAIN"` in `manifest.json`
 * is the supported MV3 approach.
 */
function pageWorldRequest(
  params:
    | { op: 'ping' }
    | { op: 'fillAkEditor' | 'fillNative'; selector: string; text: string }
    | { op: 'clickReact'; selector: string }
    | { op: 'getScenarioIds' },
  timeoutMs: number = 5_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = 'rovo-pw-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    const listener = (ev: MessageEvent) => {
      const data = ev.data;
      if (
        data
        && typeof data === 'object'
        && (data as { __rovoPageWorldResponse?: unknown }).__rovoPageWorldResponse === true
        && (data as { id?: unknown }).id === id
      ) {
        window.removeEventListener('message', listener);
        clearTimeout(timer);
        const error = (data as { error?: unknown }).error;
        if (typeof error === 'string' && error.length > 0) {
          reject(new Error('[page-world] ' + error));
        } else {
          resolve((data as { data?: unknown }).data);
        }
      }
    };
    window.addEventListener('message', listener);

    const timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      reject(
        new Error(
          'Page-world request "' + params.op + '" timed out after ' + timeoutMs + 'ms',
        ),
      );
    }, timeoutMs);

    window.postMessage(
      { __rovoPageWorldRequest: true, id, ...params },
      '*',
    );
  });
}

async function fillConversationStarters(starters: string[]): Promise<void> {
  try {
    for (const starter of starters) {
      const inputs = getByPlaceholder('Write a new conversation starter');
      const emptyInput = inputs[inputs.length - 1];
      if (!emptyInput) break;

      await pageWorldFillInput(emptyInput, starter);
      await waitForTimeout(300);
      pressKey(emptyInput, 'Tab');
      await waitForTimeout(800);
    }
  } catch {
    // optional
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
  } catch {
    // optional
  }
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
  } catch {
    // optional
  }
  await waitForTimeout(500);
}

async function addSkillsToScenario(skillNames: string[], scenarioIndex: number = 0): Promise<void> {
  try {
    // Click the correct scenario's skills modal trigger
    const triggers = document.querySelectorAll<HTMLElement>('[data-testid="scenario-tools-modal-trigger"]');
    const trigger = triggers[scenarioIndex];
    if (!trigger) {
      // eslint-disable-next-line no-console
      console.error(`[rovo] No skills modal trigger found at index ${scenarioIndex}`);
      return;
    }

    click(trigger);
    await waitForTimeout(1500);

    for (const skillName of skillNames) {
      const searchBox = getByRole('textbox', { name: /Search for a skill/i });
      if (!searchBox) continue;

      fill(searchBox, skillName);
      await waitForTimeout(1000);

      try {
        // Escape parentheses in skill name
        // Special case for skills like "Edit page (append content)" which contain parentheses
        const escapedSkillName = skillName.replace(/[()]/g, '\\$&');
        const selectBtn = await waitForElement(
          () => getByRole('button', { name: new RegExp(`Select ${escapedSkillName}`, 'i') }),
          `"Select ${skillName}" button`,
          5000,
        );
        click(selectBtn);
        await waitForTimeout(500);
      } catch {
        // skill may not exist or search timed out
        console.warn(`[rovo] Failed to add skill "${skillName}" to scenario ${scenarioIndex}`);
      }
    }

    const addBtn = getByTestId('tools-footer-add-button');
    if (addBtn) click(addBtn);
    await waitForTimeout(1000);
  } catch {
    // optional
  }
}

async function activateAgent(): Promise<void> {
  // Allow any pending AK Editor onChange debounces to settle before the
  // GraphQL createAgent mutation fires.
  await waitForTimeout(2000);
  try {
    const activateBtn = await waitForSelector('[data-testid="activate-agent-create-button"]');
    click(activateBtn);
    await waitForTimeout(2000);

    try {
      const noThanks = getByRole('button', { name: 'No thanks' });
      if (noThanks) {
        click(noThanks);
      }
    } catch {
      // dialog may not appear
    }

    await waitForTimeout(3000);
  } catch {
    // optional
  }
}

/**
 * Click the Publish button so Studio fires
 * `mutations_publishAgentVersionMutation` — which our fetch hook in
 * `page-world/inject.ts` intercepts to fire the patched
 * `mutations_agentMutation` (main agent name/desc/instructions) and one
 * `agentStudio_updateScenario` per subagent (name + instructions) before
 * the actual publish goes out.
 *
 * Without this, the user would have to click Publish manually — and
 * since per-field autosaves don't reliably fire for the instructions
 * fields, an unpublished agent has empty instructions server-side.
 *
 * Best-effort. If the button can't be located within 10s the user just
 * has to click it manually; we log a warning but don't throw.
 */
async function publishAgent(): Promise<void> {
  // Let any in-flight per-field autosaves (trigger, conversation
  // starters, etc.) settle before we trigger the publish flow. Publish
  // can race with a still-pending autosave and either:
  //   - swallow the autosave (its mutation is cancelled mid-flight), or
  //   - server-reject the publish because etag is stale.
  // 1.5s covers all the debounces we know about.
  await waitForTimeout(1500);

  const findPublishButton = (): HTMLElement | null => {
    // Test-ids first — Studio uses the `agent-heading-toolbar-*` family
    // for the toolbar buttons. The exact id has changed between builds,
    // so try a few candidates.
    for (const testId of [
      'agent-heading-toolbar-publish-button',
      'publish-agent-button',
      'agent-publish-button',
      'publish-button',
    ]) {
      const btn = getByTestId(testId);
      if (btn) return btn;
    }
    // Fall back to role + accessible-name search. Exact match on
    // "Publish" only — we don't want to pick up labels like
    // "Publish history" or "Republish".
    return getByRole('button', { name: /^Publish$/i });
  };

  let publishBtn: HTMLElement;
  try {
    publishBtn = await waitForElement(
      findPublishButton,
      '"Publish" button',
      10_000,
    );
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      '[rovo] Could not find Publish button within 10s. Agent provisioned ' +
      'but left unpublished — click Publish manually in the Studio UI to ' +
      'persist name / description / instructions.',
    );
    return;
  }

  publishBtn.scrollIntoView({ block: 'center' });

  // Use plain `element.click()`. Do NOT use pageWorldClickReact here —
  // it walks the React fiber tree and invokes EVERY onClick handler it
  // finds on every ancestor (Pressable, AK Button, container, ...),
  // each of which fires the publish mutation, which Relay then inserts
  // as separate cache entries into the agents-list connection — the
  // All Agents page shows N visual duplicates until refresh.
  click(publishBtn);

  // Wait for the publish mutation round-trip + our patch mutations to
  // finish. The page-world's publish hook is guarded to only fire
  // patches once per session, so even if publish fires multiple times
  // here only one round of patches goes out. 5s is generous for the
  // typical < 1s response time.
  //
  // NB: We intentionally do NOT poll for a confirmation `[role="dialog"]`
  // and click a confirm button. Current Studio builds publish directly
  // on the toolbar click without an intermediate confirm — trying to
  // click a "Publish" button inside a stale or post-publish dialog
  // (e.g. the success toast, an upsell modal, or a navigation guard)
  // can trigger a SECOND publish that creates duplicate cache entries.
  // If a build re-introduces a confirm dialog, add the dialog
  // handling back with a tight selector targeting a specific testid,
  // not a generic text match.
  await waitForTimeout(5000);
}