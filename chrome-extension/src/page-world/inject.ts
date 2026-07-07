/**
 * Page-world content script — runs in the page's main JavaScript world
 * (not the content-script isolated world).
 *
 * Registered in `manifest.json` with `"world": "MAIN"`. Listens for
 * `window.postMessage` requests from the isolated-world content script
 * (`provisioner.ts`) and performs DOM operations that require the page
 * world:
 *
 *   1. fillAkEditor — AK Editor / ProseMirror contenteditable fields.
 *      Locates ProseMirror's `EditorView` via `pmViewDesc` (a page-world
 *      expando exposed by ProseMirror), then dispatches a real
 *      transaction that replaces the entire document. This is the only
 *      path that reliably reaches AK Editor's plugins, including the
 *      one that commits to react-hook-form. DOM-event paths
 *      (`execCommand`, synthetic paste, `beforeinput`) all visibly
 *      insert text but in current Studio builds short-circuit before
 *      reaching the form-state plugin, so the GraphQL mutation on
 *      activate sends `instructions: ""`.
 *
 *   2. fillNative — React-controlled `<input>` / `<textarea>`.
 *      AK Atlassian's TextField exposes `onChange` directly on
 *      `__reactProps$`. We do BOTH: set the value via the page-world
 *      prototype setter AND invoke `props.onChange` with a synthetic
 *      event. The combination is reliable across react-hook-form,
 *      Formik, and uncontrolled inputs.
 *
 * Protocol:
 *   Request:  { __rovoPageWorldRequest: true, id, op, selector?, text? }
 *   Response: { __rovoPageWorldResponse: true, id, error: string|null, data? }
 *
 *   Ops: 'ping' | 'fillAkEditor' | 'fillNative'
 */

const PAGE_WORLD_VERSION = 22;

interface RovoPageWorldRequest {
  __rovoPageWorldRequest: true;
  id: string;
  op: string;
  selector?: string;
  text?: string;
}

interface RovoPageWorldResponse {
  __rovoPageWorldResponse: true;
  id: string;
  error: string | null;
  data?: unknown;
}

(function rovoPageWorldInit() {
  // Idempotency guard. The version number lets the isolated world detect
  // a stale page-world script after an extension upgrade.
  const W = window as unknown as {
    __rovoPageWorldInstalled?: number;
    __rovoCapture?: RovoCapture[];
    __rovoCaptureInstalled?: boolean;
    // Last full body + URL captured for each GraphQL operation name. Used
    // by the pre-publish patch (see firePatchedAgentMutation) to clone
    // the captured template instead of hardcoding the GraphQL query
    // string or hash.
    __rovoLastBodies?: Record<string, string>;
    __rovoLastUrls?: Record<string, string>;
    // Insertion-ordered list of distinct scenario ARIs seen in any
    // GraphQL response body. Provisioner snapshots this before clicking
    // "Add new scenario" and polls for a new entry afterwards so it can
    // stash the new subagent's scenarioId on its DOM container directly,
    // bypassing all DOM-order / autosave-template guessing.
    __rovoSeenScenarioIds?: string[];
    fetch: typeof fetch;
  };
  if (W.__rovoPageWorldInstalled) return;
  W.__rovoPageWorldInstalled = PAGE_WORLD_VERSION;

  // Loud load marker so we can confirm in DevTools that THIS version of
  // inject.js actually ran. If you don't see this line in console after
  // hard-reloading the Studio tab, the page-world script never loaded.
  // eslint-disable-next-line no-console
  console.warn(
    '[rovo-page-world] inject.js v' + PAGE_WORLD_VERSION + ' loaded. ' +
    'Capture available at: window.__rovoCapture',
  );

  // GraphQL capture for reverse-engineering Studio's mutation schema.
  // Each entry is the operation + body of a POST to /gateway/api/graphql/.
  // Inspect from DevTools console: JSON.stringify(window.__rovoCapture, null, 2)
  type RovoCapture = {
    timestamp: number;
    operationName: string;
    url: string;
    bodyPreview: string;
    bodyLength: number;
    responsePreview?: string;
  };

  function installFetchCapture(): void {
    if (W.__rovoCaptureInstalled) return;
    W.__rovoCaptureInstalled = true;
    W.__rovoCapture = [];
    W.__rovoLastBodies = W.__rovoLastBodies ?? {};
    W.__rovoLastUrls = W.__rovoLastUrls ?? {};
    const originalFetch = W.fetch.bind(W);
    W.fetch = async function rovoCapturingFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      const method = (init?.method
        ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

      if (method === 'POST' && url.includes('/gateway/api/graphql/')) {
        let bodyText = '';
        try {
          if (typeof init?.body === 'string') {
            bodyText = init.body;
          } else if (init?.body instanceof Blob) {
            bodyText = await init.body.text();
          } else if (init?.body instanceof FormData) {
            bodyText = '[FormData]';
          }
        } catch {
          /* ignore body-read errors */
        }
        let opName = '';
        try {
          opName = new URL(url, location.href).searchParams.get('operation') ?? '';
        } catch {
          /* ignore url parse errors */
        }

        // PATCH: Inject instructions into createAgentMutation if missing
        if (opName === 'createAgentMutation' && bodyText && typeof init?.body === 'string') {
          try {
            const payload = JSON.parse(bodyText);
            const input = payload?.variables?.input;
            if (input) {
              let patched = false;

              // Main agent name from heading
              if (input.name === 'Untitled') {
                const nameHeading = document.querySelector<HTMLElement>(
                  '[data-testid="agent-heading-toolbar-name-field-read-view"]'
                );
                const name = nameHeading?.textContent?.trim();
                if (name && name !== 'Untitled') {
                  input.name = name;
                  patched = true;
                }
              }

              // Main agent description (if available)
              const descHeading = document.querySelector<HTMLElement>(
                '[data-testid="agent-heading-toolbar-description-field-read-view"]'
              );
              const description = descHeading?.textContent?.trim();
              if (description && description !== 'Add a description' && !input.description) {
                input.description = description;
                patched = true;
              }

              // Main agent instructions
              if (!input.instructions) {
                const editor = document.querySelector<HTMLElement>(
                  '[data-testid="core-instructions-editor"] [contenteditable="true"]'
                );
                if (editor) {
                  const instructions = serializePMDoc(editor);
                  if (instructions) {
                    input.instructions = instructions;
                    patched = true;
                  }
                }
              }

              // Subagent instructions + names + invocationDescription (triggers)
              if (Array.isArray(input.scenarios)) {
                const allEditors = document.querySelectorAll<HTMLElement>('[contenteditable="true"]');
                const nameInputs = document.querySelectorAll<HTMLInputElement>('input[aria-label="Scenario name"]');

                // Find trigger textarea after each name input
                const findTriggerTextarea = (nameIdx: number): string | null => {
                  const nameInput = nameInputs[nameIdx];
                  if (!nameInput) return null;
                  const all = Array.from(document.querySelectorAll<HTMLElement>('textarea, input[aria-label="Scenario name"]'));
                  const idx = all.indexOf(nameInput);
                  if (idx === -1) return null;
                  for (let i = idx + 1; i < all.length; i++) {
                    const el = all[i];
                    if (el.tagName === 'TEXTAREA') {
                      return (el as HTMLTextAreaElement).value?.trim() || null;
                    }
                    if (el.getAttribute('aria-label') === 'Scenario name') break;
                  }
                  return null;
                };

                input.scenarios.forEach((scenario: {
                  instructions?: string;
                  name?: string;
                  invocationDescription?: string;
                  isActive?: boolean;
                }, idx: number) => {
                  // Instructions
                  if (!scenario.instructions) {
                    const editor = allEditors[idx + 1];
                    if (editor) {
                      const instructions = serializePMDoc(editor);
                      if (instructions) {
                        scenario.instructions = instructions;
                        patched = true;
                      }
                    }
                  }

                  // Name
                  if (scenario.name === 'Untitled' && nameInputs[idx]) {
                    const name = nameInputs[idx].value?.trim();
                    if (name && name !== 'Untitled') {
                      scenario.name = name;
                      patched = true;
                    }
                  }

                  // invocationDescription (trigger)
                  if (!scenario.invocationDescription) {
                    const triggerText = findTriggerTextarea(idx);
                    if (triggerText) {
                      scenario.invocationDescription = triggerText;
                      patched = true;
                    }
                  }

                  // Auto-enable scenarios (default behavior: if provisioning, activate)
                  if (scenario.isActive === false) {
                    scenario.isActive = true;
                    patched = true;
                  }
                });
              }

              if (patched) {
                bodyText = JSON.stringify(payload);
                init.body = bodyText;
              }
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[ROVO PATCH] Failed to patch mutation:', e);
          }
        }

        const entry: RovoCapture = {
          timestamp: Date.now(),
          operationName: opName,
          url: url.length > 200 ? url.slice(0, 200) + '…' : url,
          bodyPreview: bodyText.slice(0, 4000),
          bodyLength: bodyText.length,
        };
        const list = W.__rovoCapture ?? [];
        list.push(entry);
        if (list.length > 30) list.shift();
        W.__rovoCapture = list;

        // Save the most-recent full body + URL for each operation so other
        // patch blocks (notably the pre-publish patcher below) can clone
        // them as templates. We capture the full body here — the capture
        // array's `bodyPreview` is truncated at 4000 chars for inspection
        // ergonomics, which would lose the tail of a long instructions
        // field if we tried to clone from there.
        if (bodyText && opName) {
          W.__rovoLastBodies = W.__rovoLastBodies ?? {};
          W.__rovoLastBodies[opName] = bodyText;
          W.__rovoLastUrls = W.__rovoLastUrls ?? {};
          W.__rovoLastUrls[opName] = url;
        }

        // PATCH: Studio's v2-beta flow no longer puts agent data into a
        // single createAgentMutation. The initial createAgent call only
        // creates a stub; per-field autosaves (mutations_agentMutation,
        // scenarioNameField_*, triggerField_*, conversationStartersField_*,
        // etc.) write the rest as the user types. The main-agent and
        // subagent INSTRUCTIONS fields are the holdout — their
        // instructionsField_???Mutation never fires from a programmatic
        // PM transaction, so when the user clicks Publish the server
        // sees empty instructions.
        //
        // The fix: just before publishAgentVersionMutation goes out,
        // clone the most recent mutations_agentMutation we captured
        // during this session (which has the right GraphQL query string,
        // operation hash, and variable shape for the current Studio
        // build), replace its variables.input with everything we can
        // read out of DOM + PM, and fire it. Then let publish proceed.
        if (opName === 'mutations_publishAgentVersionMutation') {
          // Fire main-agent + per-subagent patches in parallel before
          // publish goes out. Failures are non-fatal so publish still
          // proceeds even if our patch errors.
          //
          // NB: We tried a "once per session" guard here in v19 to
          // dedupe Relay-cache writes, but the real cause of the
          // duplicate agent rows was elsewhere (activateAgent firing
          // a second createAgentMutation). The guard was too sticky —
          // provisioning a second agent in the same Studio tab session
          // would skip patches entirely, leaving the new agent saved
          // as "Untitled" with no instructions. Don't re-add it.
          try {
            await Promise.allSettled([
              firePatchedAgentMutation(originalFetch, init),
              firePatchedScenarioMutations(originalFetch, init),
            ]);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.error(
              '[ROVO PATCH] Pre-publish patches failed (non-fatal):',
              e,
            );
          }
        }

        // Capture response body too — we need to see what the server
        // returns for the activate mutation to confirm what was saved.
        const resp = await originalFetch(input, init);
        try {
          const clone = resp.clone();
          const text = await clone.text();
          entry.responsePreview = text.slice(0, 2000);

          // Also walk the FULL response (not the truncated preview) for
          // scenario ARIs and append any new ones to the seen list.
          // newEmptyScenarioMutation, agentStudio_updateScenario, and
          // related calls all return scenarioList payloads that contain
          // the canonical id. Tracking them here gives the provisioner
          // a deterministic way to map each newly-added subagent to its
          // scenarioId without relying on DOM order.
          try {
            const parsed = JSON.parse(text);
            const found: string[] = [];
            const walk = (v: unknown): void => {
              if (typeof v === 'string') {
                if (v.startsWith('ari:cloud:rovo::scenario/')) found.push(v);
                return;
              }
              if (!v || typeof v !== 'object') return;
              if (Array.isArray(v)) { v.forEach(walk); return; }
              Object.values(v).forEach(walk);
            };
            walk(parsed);
            if (found.length > 0) {
              W.__rovoSeenScenarioIds = W.__rovoSeenScenarioIds ?? [];
              const seen = W.__rovoSeenScenarioIds;
              const seenSet = new Set(seen);
              for (const id of found) {
                if (!seenSet.has(id)) { seen.push(id); seenSet.add(id); }
              }
            }
          } catch {
            /* ignore parse errors — not all responses are JSON */
          }
        } catch {
          /* ignore */
        }
        return resp;
      }
      return originalFetch(input, init);
    } as typeof fetch;
  }

  /**
   * Clone the most recent captured `mutations_agentMutation` and fire a
   * patched copy populated from DOM/PM data. Called just before the
   * outgoing `mutations_publishAgentVersionMutation` is forwarded.
   *
   * Why a captured-template clone (instead of hardcoding the GraphQL
   * query): Studio's persisted-query IDs and operation hashes change
   * between builds, and so does the exact shape of `variables.input`.
   * The captured template is by-definition the current shape, so we
   * only have to override the field values we care about.
   *
   * For now this handles main-agent fields (name, description,
   * instructions). Subagent instructions need their own scenario-level
   * mutation clone — we don't yet have a template for that because the
   * per-scenario instructions field never autosaves — so it's a TODO
   * for the next iteration. The captured scenario mutations
   * (scenarioNameField / triggerField / conversationStartersField)
   * will give us the right scenarioId(s) when we add that.
   *
   * Best-effort: any failure is logged and swallowed so the original
   * publish still goes through.
   */
  async function firePatchedAgentMutation(
    originalFetch: typeof fetch,
    publishInit: RequestInit | undefined,
  ): Promise<void> {
    const templateBody = W.__rovoLastBodies?.['mutations_agentMutation'];
    const templateUrl = W.__rovoLastUrls?.['mutations_agentMutation'];
    if (!templateBody || !templateUrl) {
      // eslint-disable-next-line no-console
      console.warn(
        '[ROVO PATCH] No captured mutations_agentMutation template available; ' +
        'pre-publish patch skipped. Studio may not have fired the per-field ' +
        'name/description autosave yet.',
      );
      return;
    }

    let parsed: {
      query?: string;
      operationName?: string;
      extensions?: unknown;
      variables?: { input?: Record<string, unknown> } & Record<string, unknown>;
    };
    try {
      parsed = JSON.parse(templateBody);
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[ROVO PATCH] Could not parse captured agentMutation template body.');
      return;
    }

    if (!parsed.variables || !parsed.variables.input) {
      // eslint-disable-next-line no-console
      console.warn(
        '[ROVO PATCH] agentMutation template has no variables.input; shape unexpected. ' +
        'Inspect window.__rovoLastBodies.mutations_agentMutation to debug.',
      );
      return;
    }

    // Read main-agent fields out of the DOM + PM doc.
    const nameEl = document.querySelector<HTMLElement>(
      '[data-testid="agent-heading-toolbar-name-field-read-view"]',
    );
    const descEl = document.querySelector<HTMLElement>(
      '[data-testid="agent-heading-toolbar-description-field-read-view"]',
    );
    const editorEl = document.querySelector<HTMLElement>(
      '[data-testid="core-instructions-editor"] [contenteditable="true"]',
    );

    const name = nameEl?.textContent?.trim();
    const description = descEl?.textContent?.trim();
    const instructions = editorEl ? serializePMDoc(editorEl) : null;

    // Build a patched input: start from the template's input so we
    // preserve every field the server needs (agent id, workspace id,
    // version handles, etc.), then override the ones we know.
    const patchedInput: Record<string, unknown> = { ...parsed.variables.input };
    if (name && name !== 'Untitled') patchedInput.name = name;
    if (description && description !== 'Add a description') {
      patchedInput.description = description;
    }
    if (instructions) patchedInput.instructions = instructions;

    const patchedBody = JSON.stringify({
      ...parsed,
      variables: { ...parsed.variables, input: patchedInput },
    });

    // Re-use the publish call's init for headers, credentials, CSRF
    // token, etc. Same endpoint, same auth context.
    const newInit: RequestInit = {
      ...(publishInit ?? {}),
      method: 'POST',
      body: patchedBody,
    };

    const resp = await originalFetch(templateUrl, newInit);
    const respText = await resp.clone().text().catch(() => '');
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.error(
        '[ROVO PATCH] Pre-publish agentMutation HTTP failure:',
        resp.status,
        respText.slice(0, 800),
      );
      return;
    }
  }

  /**
   * Patch each subagent's name + instructions just before publish.
   *
   * Studio's per-scenario autosaves — scenarioNameField_*, triggerField_*,
   * etc. — all hit the same backend resolver
   * (`agentStudio_updateScenario` / `agentStudio_updateScenarioDetails`),
   * differing only in the persisted-query hash. Request body shape:
   *
   *   variables: { id: <scenarioARI>, input: { containerId: <agentARI>, ...partial scenario fields } }
   *
   * The server accepts any subset of fields in `input`, so we can clone
   * a captured scenarioNameField_* (or triggerField_*) template and
   * push name + instructions in a single call per subagent.
   *
   * Source of truth: each subagent's container is stamped at provision
   * time with these data-attributes by `stashSubagentDataAttrs` in
   * provisioner.ts:
   *   - data-rovo-scenario-id           — the scenario's ARI (captured
   *                                       from newEmptyScenarioMutation's
   *                                       response right after Add click)
   *   - data-rovo-scenario-name         — the desired name
   *   - data-rovo-scenario-instructions — the desired instructions
   *
   * We iterate containers directly via `[data-rovo-scenario-id]`. There
   * is no DOM-order guessing, no autosave-trigger requirement, no
   * cross-referencing between captures. If the container is stamped we
   * patch it; otherwise we skip (and log a warning).
   *
   * Best-effort: each subagent patch is isolated — one failure does not
   * abort the others.
   */
  async function firePatchedScenarioMutations(
    originalFetch: typeof fetch,
    publishInit: RequestInit | undefined,
  ): Promise<void> {
    const subagentContainers = Array.from(
      document.querySelectorAll<HTMLElement>('[data-rovo-scenario-id]'),
    );
    // Cross-check against the page-world's tally of every scenarioId
    // ever seen in a response body. If the count diverges, some
    // subagents were never stamped — their containers got overwritten
    // upstream or scenarioId capture was missed. Either way, those
    // subagents won't be patched, which would silently leave them as
    // "Untitled" after publish. Make it loud.
    const seenIds = W.__rovoSeenScenarioIds ?? [];
    const stampedIds = new Set(
      subagentContainers
        .map((c) => c.getAttribute('data-rovo-scenario-id'))
        .filter((id): id is string => typeof id === 'string'),
    );
    const orphanIds = seenIds.filter((id) => !stampedIds.has(id));
    if (orphanIds.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        '[ROVO PATCH] Mismatch: ' + seenIds.length + ' scenarioId(s) seen in responses ' +
        'but only ' + subagentContainers.length + ' container(s) stamped. ' +
        'Orphan scenarioIds (will NOT be patched):',
        orphanIds.map((id) => id.slice(-12)),
      );
    }

    if (subagentContainers.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '[ROVO PATCH] No subagent containers stamped with data-rovo-scenario-id; ' +
        'subagent patch skipped. (Did provisioner.ts stashSubagentDataAttrs run?)',
      );
      return;
    }

    const templateOpName = W.__rovoLastBodies?.['scenarioNameField_UpdateScenarioMutation']
      ? 'scenarioNameField_UpdateScenarioMutation'
      : W.__rovoLastBodies?.['triggerField_UpdateScenarioMutation']
      ? 'triggerField_UpdateScenarioMutation'
      : null;
    if (!templateOpName) {
      // eslint-disable-next-line no-console
      console.warn(
        '[ROVO PATCH] No scenario mutation template captured; subagent patch skipped. ' +
        'Did any per-scenario autosave fire during provisioning?',
      );
      return;
    }
    const templateBody = W.__rovoLastBodies?.[templateOpName];
    const templateUrl = W.__rovoLastUrls?.[templateOpName];
    if (!templateBody || !templateUrl) return;

    let parsed: {
      variables?: {
        id?: string;
        input?: { containerId?: string } & Record<string, unknown>;
      } & Record<string, unknown>;
    } & Record<string, unknown>;
    try {
      parsed = JSON.parse(templateBody);
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[ROVO PATCH] Could not parse scenario template body.');
      return;
    }

    const containerId = parsed.variables?.input?.containerId;
    if (!containerId) {
      // eslint-disable-next-line no-console
      console.warn('[ROVO PATCH] Scenario template missing containerId; skipping.');
      return;
    }

    const tasks = subagentContainers.map(async (container, i) => {
      const scenarioId = container.getAttribute('data-rovo-scenario-id')?.trim();
      if (!scenarioId) {
        // eslint-disable-next-line no-console
        console.warn('[ROVO PATCH] Subagent[' + i + '] missing data-rovo-scenario-id; skipping.');
        return;
      }
      const name = container.getAttribute('data-rovo-scenario-name')?.trim() ?? '';
      const instructions = container.getAttribute('data-rovo-scenario-instructions') ?? '';

      const patchedInput: Record<string, unknown> = { containerId };
      if (name && name !== 'Untitled') patchedInput.name = name;
      if (instructions.length > 0) patchedInput.instructions = instructions;

      if (Object.keys(patchedInput).length === 1) {
        // eslint-disable-next-line no-console
        console.warn(
          '[ROVO PATCH] Subagent[' + i + '] (' + scenarioId.slice(-12) +
          ') has no stashed name/instructions; skipping.',
        );
        return;
      }

      const patchedBody = JSON.stringify({
        ...parsed,
        variables: {
          ...parsed.variables,
          id: scenarioId,
          input: patchedInput,
        },
      });

      const newInit: RequestInit = {
        ...(publishInit ?? {}),
        method: 'POST',
        body: patchedBody,
      };

      try {
        const resp = await originalFetch(templateUrl, newInit);
        const respText = await resp.clone().text().catch(() => '');
        if (!resp.ok) {
          // eslint-disable-next-line no-console
          console.error(
            '[ROVO PATCH] Subagent[' + i + '] HTTP failure:',
            resp.status,
            respText.slice(0, 500),
          );
          return;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(
          '[ROVO PATCH] Subagent[' + i + '] fetch threw:',
          e instanceof Error ? e.message : String(e),
        );
      }
    });

    await Promise.allSettled(tasks);
  }

  /**
   * Serialize a ProseMirror document to markdown-ish plain text.
   * Walks the PM doc found via `findEditorView` for the given editor
   * element and converts headings / paragraphs / lists to lines.
   *
   * Returns `null` if the EditorView can't be located (which usually
   * means the editor is a stub that hasn't been initialised yet).
   */
  function serializePMDoc(editor: HTMLElement): string | null {
    const located = findEditorView(editor);
    if (!located) return null;
    const { view } = located;
    const doc = view.state.doc;
    const lines: string[] = [];

    const serializeNode = (node: {
      type?: { name?: string };
      textContent?: string;
      attrs?: { level?: number };
      marks?: { type?: { name?: string } }[];
      content?: { forEach?: (fn: (n: unknown) => void) => void };
      text?: string;
    }): string => {
      const type = node.type?.name;
      if (type === 'heading' && node.textContent) {
        const level = node.attrs?.level ?? 1;
        return '#'.repeat(level) + ' ' + node.textContent;
      }
      if (type === 'paragraph') {
        if (!node.content) return '';
        let text = '';
        node.content.forEach?.((child: {
          text?: string;
          marks?: { type?: { name?: string } }[];
        }) => {
          let childText = child.text ?? '';
          if (child.marks) {
            child.marks.forEach((mark: { type?: { name?: string } }) => {
              if (mark.type?.name === 'strong') childText = '**' + childText + '**';
              if (mark.type?.name === 'em') childText = '*' + childText + '*';
              if (mark.type?.name === 'code') childText = '`' + childText + '`';
            });
          }
          text += childText;
        });
        return text;
      }
      if (type === 'bulletList' || type === 'orderedList') {
        const items: string[] = [];
        node.content?.forEach?.((item: { content?: { forEach?: (fn: (n: unknown) => void) => void } }) => {
          let itemText = '';
          item.content?.forEach?.((para: { textContent?: string }) => {
            itemText += para.textContent ?? '';
          });
          items.push((type === 'bulletList' ? '- ' : '1. ') + itemText);
        });
        return items.join('\n');
      }
      return node.textContent ?? '';
    };

    doc.forEach((node: Parameters<typeof serializeNode>[0]) => {
      const line = serializeNode(node);
      if (line) lines.push(line);
    });

    return lines.join('\n\n').trim();
  }

  installFetchCapture();

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(() => r(), ms));

  // Minimal structural types for the bits of ProseMirror we touch.
  // We intentionally avoid `import` from `prosemirror-*` packages so this
  // page-world script stays a zero-dependency self-contained file.
  type PMNode = unknown;
  type PMTr = {
    replaceWith: (from: number, to: number, content: PMNode | PMNode[]) => PMTr;
  };
  type PMState = {
    doc: { content: { size: number } };
    tr: PMTr;
    schema: PMSchema;
  };
  type PMSchema = {
    nodes: Record<string, { create: (...args: unknown[]) => PMNode }>;
    text: (s: string) => PMNode;
  };
  type PMView = { state: PMState; dispatch: (tr: PMTr) => void };

  /**
   * Find ProseMirror's `EditorView` for a given contenteditable.
   *
   * Atlassian's Studio build strips `pmViewDesc.view`, so the standard
   * "walk the descriptor tree" trick doesn't work. Instead we walk the
   * React fiber tree starting at the contenteditable's fiber, going up
   * the `return` chain, and searching each ancestor's subtree (children
   * + memoizedProps + hook state) for an object that quacks like an
   * EditorView (`dispatch` function + `state.doc` + `state.tr`).
   *
   * In current Studio, the path is roughly:
   *   editor.__reactFiber$.return.return → search subtree → memoizedProps.editorView
   */
  function findEditorView(start: Element): { view: PMView; schema: PMSchema } | null {
    const looksLikeView = (obj: unknown): obj is PMView => {
      if (!obj || typeof obj !== 'object') return false;
      const o = obj as { dispatch?: unknown; state?: { doc?: unknown; tr?: unknown; schema?: unknown } };
      return typeof o.dispatch === 'function'
        && !!o.state
        && typeof o.state === 'object'
        && !!o.state.doc
        && !!o.state.tr
        && !!o.state.schema;
    };

    const searchFiber = (
      fiber: unknown,
      depth: number,
      visited: WeakSet<object>,
    ): PMView | null => {
      if (!fiber || typeof fiber !== 'object' || depth > 40) return null;
      const f = fiber as Record<string, unknown>;
      if (visited.has(f as unknown as object)) return null;
      visited.add(f as unknown as object);

      const memoProps = f.memoizedProps as Record<string, unknown> | undefined;
      if (memoProps) {
        if (looksLikeView(memoProps.editorView)) return memoProps.editorView;
        if (looksLikeView(memoProps.view)) return memoProps.view;
      }
      const memoState = f.memoizedState as Record<string, unknown> | null | undefined;
      if (memoState) {
        if (looksLikeView(memoState.editorView)) return memoState.editorView;
        if (looksLikeView(memoState.view)) return memoState.view;
        let hook: Record<string, unknown> | null | undefined = memoState;
        for (let i = 0; i < 50 && hook; i++) {
          const hookState = hook.memoizedState;
          if (looksLikeView(hookState)) return hookState;
          if (hookState && typeof hookState === 'object') {
            const ref = hookState as Record<string, unknown>;
            if (looksLikeView(ref.current)) return ref.current as PMView;
            if (looksLikeView(ref.editorView)) return ref.editorView as PMView;
          }
          hook = hook.next as Record<string, unknown> | null | undefined;
        }
      }
      return searchFiber(f.child, depth + 1, visited)
        ?? searchFiber(f.sibling, depth + 1, visited);
    };

    let cur: Element | null = start;
    for (let i = 0; i < 30 && cur; i++) {
      const fiberKey = Object.keys(cur).find((k) => k.startsWith('__reactFiber$'));
      if (fiberKey) {
        const visited = new WeakSet<object>();
        let fiber = (cur as unknown as Record<string, unknown>)[fiberKey] as
          | Record<string, unknown>
          | undefined;
        for (let r = 0; r < 50 && fiber; r++) {
          const found = searchFiber(fiber, 0, visited);
          if (found) {
            return { view: found, schema: found.state.schema };
          }
          fiber = fiber.return as Record<string, unknown> | undefined;
        }
      }
      cur = cur.parentElement;
    }
    return null;
  }

  /**
   * Build a ProseMirror document fragment from plain text using the
   * provided schema. Handles paragraph breaks (`\n\n+`) and hard breaks
   * (single `\n`) when the schema declares those nodes.
   */
  function buildDocFromText(schema: PMSchema, text: string): PMNode[] {
    const paragraphs = text.split(/\n{2,}/);
    const hardBreak = schema.nodes.hardBreak;
    return paragraphs.map((para) => {
      const lines = para.split('\n');
      const inlines: PMNode[] = [];
      lines.forEach((line, idx) => {
        if (idx > 0 && hardBreak) inlines.push(hardBreak.create());
        if (line.length > 0) inlines.push(schema.text(line));
      });
      return schema.nodes.paragraph.create({}, inlines);
    });
  }

  /**
   * Fill a ProseMirror / AK Editor contenteditable by dispatching a
   * transaction that replaces the entire document. See header comment
   * on this file for why this is the only reliable path.
   */
  async function fillAkEditor(
    selector: string,
    text: string,
  ): Promise<{ error: string | null; data?: { docText: string; domText: string; reFound: boolean } }> {
    const wrapper = document.querySelector(selector);
    if (!wrapper) return { error: 'wrapper not found: ' + selector };
    const editor = wrapper.matches('[contenteditable="true"]')
      ? wrapper
      : wrapper.querySelector('[contenteditable="true"]');
    if (!editor || !(editor instanceof HTMLElement)) {
      return { error: 'contenteditable not found in wrapper: ' + selector };
    }

    editor.focus();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await sleep(100);

    const located = findEditorView(editor);
    if (!located) {
      return { error: 'ProseMirror EditorView not found via React fiber walk' };
    }
    const { view, schema } = located;

    try {
      const docNodes = buildDocFromText(schema, text);
      const tr = view.state.tr as unknown as {
        replaceWith: PMTr['replaceWith'];
        setMeta: (key: string, value: unknown) => PMTr;
      };
      // Mark the transaction as a real user-input edit. AK Editor's
      // autosave plugin checks transaction metadata to distinguish
      // programmatic doc updates (init, undo/redo) from user edits.
      // Without this, our PM dispatch may be silently ignored by the
      // autosave plugin, which is why `instructionsField_???Mutation`
      // never fires for the main or subagent instructions fields.
      try { tr.setMeta('addToHistory', true); } catch { /* noop */ }
      try { tr.setMeta('uiEvent', 'input'); } catch { /* noop */ }
      tr.replaceWith(0, view.state.doc.content.size, docNodes);
      view.dispatch(tr as unknown as PMTr);
    } catch (e) {
      return { error: 'PM dispatch failed: ' + (e instanceof Error ? e.message : String(e)) };
    }

    // Fire an `input` event to wake up any DOM-event listeners (AK Editor
    // wires its onChange callback via a MutationObserver in some builds;
    // an explicit InputEvent guarantees it sees the change).
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertText',
    }));

    // Let AK Editor's internal plugins observe the transaction and
    // schedule debounced onChange handlers. Studio's autosave for
    // `instructions` is usually a 500–1000ms debounce on onChange, so
    // we wait long enough for that debounce to fire BEFORE we blur.
    // Without this wait, the blur fires before the debounce, the
    // debounce gets cancelled by the focus shift, and the autosave
    // mutation is never sent.
    await sleep(1500);

    // DO NOT brute-force invoke onChange/onBlur on every fiber ancestor.
    // We tried that in v11–v13 and it caused crashes: passing a PMView or
    // a DOM-referencing fake event to a randomly-matched onChange ended
    // up writing those values into AK Editor's controlled-value state.
    // On the next render AK Editor called its own `replaceDocument(value)`
    // proxy with a DOM element, which JSON.stringify'd the circular
    // __reactFiber$ → stateNode loop and threw
    // "Converting circular structure to JSON" — nuking the editor's
    // value in the process, so the field saved as empty.
    //
    // PM's transaction pipeline is the right propagation channel:
    // AK Editor's value plugin observes every dispatched transaction
    // and calls its onChange callback internally. Our job is just to
    // give that plugin time to fire and to provide a real blur event
    // so the debounced autosave flushes.

    // Try the DOM-walk onBlur path — this only invokes onBlur props
    // attached directly via React's standard __reactProps$ on the
    // editor's DOM ancestors (form wrappers, RHF Controller's outer
    // div). The fake event is intentionally DOM-ref-free so handlers
    // that JSON.stringify their event for logging don't crash.
    callOnBlurInFiber(editor);

    editor.blur();

    // Real focusout (bubbling) — AK Editor and surrounding wrappers
    // sometimes listen for `focusout` rather than the non-bubbling
    // `blur` event.
    editor.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false }));
    editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: false }));

    // Force a REAL focus transition by clicking on a known-safe
    // outside element. `document.body.focus()` doesn't reliably move
    // focus away from a contenteditable, but clicking the Name
    // InlineEdit toolbar (or any agent-heading element) does — and a
    // real focus transition is what AK Editor's blur plugin needs to
    // flush its pending autosave.
    try {
      const outsideTarget = document.querySelector<HTMLElement>(
        '[data-testid="agent-heading-toolbar-name-field-read-view"]'
      ) ?? document.querySelector<HTMLElement>('body');
      if (outsideTarget) {
        outsideTarget.focus();
        outsideTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    } catch { /* noop */ }

    // Final wait for the autosave mutation to actually go out before
    // the next field steals focus and cancels any still-pending
    // debounced save.
    await sleep(1500);

    // Build a result that lets the isolated world verify the dispatch
    // succeeded. We read PM's own view of the doc (always accurate,
    // even if AK Editor remounted the contenteditable and our local
    // `editor` ref is now orphaned). We also re-query the live wrapper
    // for its current contenteditable text — if the two diverge it
    // means PM was dispatched on a stale/wrong view.
    let docText = '';
    try {
      const doc = view.state.doc as unknown as { textContent?: unknown };
      if (typeof doc.textContent === 'string') docText = doc.textContent;
    } catch { /* leave empty */ }

    let domText = '';
    let reFound = false;
    try {
      const liveWrapper = document.querySelector(selector);
      const liveEditor = liveWrapper && (
        liveWrapper.matches('[contenteditable="true"]')
          ? liveWrapper
          : liveWrapper.querySelector('[contenteditable="true"]')
      );
      if (liveEditor instanceof HTMLElement) {
        reFound = liveEditor !== editor;
        domText = (liveEditor.textContent ?? '').replace(/\u200C/g, '');
      }
    } catch { /* leave empty */ }

    return { error: null, data: { docText, domText, reFound } };
  }

  /**
   * Walk the DOM ancestor chain starting at `start` and invoke the first
   * `onBlur` prop attached via React's standard `__reactProps$`. Used to
   * flush react-hook-form / formik blur-autosave handlers when our
   * synthetic `.blur()` doesn't reach them (notably for ProseMirror's
   * contenteditable, where blur is dispatched on the child but the
   * onBlur prop is attached to a wrapping component).
   *
   * The fake event we pass deliberately contains NO DOM references and
   * NO React-fiber references. Some onBlur handlers — especially when
   * routed through error trackers like Sentry — attempt to
   * `JSON.stringify` the event for logging context. If `event.target`
   * is a DOM element, JSON.stringify follows the `__reactFiber$` expando,
   * hits the circular `fiber → stateNode → element` loop, and throws
   * "Converting circular structure to JSON".
   *
   * Best-effort: per-handler errors are swallowed.
   */
  function callOnBlurInFiber(start: Element): void {
    const fakeBlurEvent = {
      type: 'blur',
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      eventPhase: 2,
      isTrusted: false,
      preventDefault() { /* noop */ },
      stopPropagation() { /* noop */ },
      persist() { /* noop */ },
    };
    let cur: Element | null = start;
    for (let i = 0; i < 20 && cur; i++) {
      const propsKey = Object.keys(cur).find((k) => k.startsWith('__reactProps$'));
      if (propsKey) {
        const props = (cur as unknown as Record<string, Record<string, unknown>>)[propsKey];
        const onBlur = props.onBlur;
        if (typeof onBlur === 'function') {
          try { (onBlur as (e: unknown) => void)(fakeBlurEvent); } catch { /* fall through */ }
        }
      }
      cur = cur.parentElement;
    }
  }

  /**
   * Fill a React-controlled `<input>` or `<textarea>`. Two-pronged:
   *   1. Set value via the page-world's prototype setter so React's
   *      `_valueTracker` is bypassed correctly and a subsequent
   *      `input` event is treated as a real user change.
   *   2. Invoke `props.onChange` directly via `__reactProps$` with a
   *      synthetic event. AK Atlassian's `TextField` exposes onChange
   *      directly on the input's React props, so this is a guaranteed
   *      path to the parent's form binding (react-hook-form, Formik,
   *      or plain useState).
   *
   * Either path alone has been observed to fail on current Studio
   * builds; the combination is reliable.
   */
  async function fillNative(selector: string, text: string): Promise<string | null> {
    const el = document.querySelector(selector);
    if (!el) return 'element not found: ' + selector;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
      return 'element is not <input> or <textarea>: ' + selector;
    }
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!setter) return 'no native value setter on prototype';

    el.focus();
    await sleep(100);

    // Select existing content so DOM-level "input" replaces, not appends.
    try { el.select(); } catch { /* noop */ }

    setter.call(el, text);

    // Invoke the React onChange prop directly. AK TextField exposes this
    // on `__reactProps$<id>`. We build a minimal SyntheticEvent-like
    // object — react-hook-form / Formik / plain useState all read only
    // `event.target.value`.
    const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
    if (propsKey) {
      const props = (el as unknown as Record<string, Record<string, unknown>>)[propsKey];
      const fakeEvent = {
        target: el,
        currentTarget: el,
        type: 'change',
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        eventPhase: 2,
        isTrusted: false,
        preventDefault() { /* noop */ },
        stopPropagation() { /* noop */ },
        persist() { /* noop */ },
        nativeEvent: { target: el, type: 'input' },
      };
      const onChange = props.onChange;
      if (typeof onChange === 'function') {
        try { (onChange as (e: unknown) => void)(fakeEvent); } catch { /* fall through */ }
      }
      const onInput = props.onInput;
      if (typeof onInput === 'function') {
        try { (onInput as (e: unknown) => void)(fakeEvent); } catch { /* fall through */ }
      }
    }

    // Also dispatch real DOM events as a belt-and-braces fallback.
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
      composed: true,
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    await sleep(300);

    // Call props.onBlur BEFORE the DOM blur. Studio's per-field
    // autosave for subagent name / invocationDescription (trigger) /
    // is wired through react-hook-form's `register({onBlur})` — the
    // returned onBlur is what fires the `mutations_agentMutation` /
    // `mutations_scenarioMutation` for that field. Without this call
    // we update RHF state via onChange but the blur-triggered autosave
    // never runs, so the field is empty on the server and shows as
    // "Untitled" / blank after publish.
    if (propsKey) {
      const props = (el as unknown as Record<string, Record<string, unknown>>)[propsKey];
      const onBlur = props.onBlur;
      if (typeof onBlur === 'function') {
        try {
          (onBlur as (e: unknown) => void)({
            target: el,
            currentTarget: el,
            type: 'blur',
            bubbles: false,
            cancelable: false,
            defaultPrevented: false,
            eventPhase: 2,
            isTrusted: false,
            preventDefault() { /* noop */ },
            stopPropagation() { /* noop */ },
            persist() { /* noop */ },
            nativeEvent: { target: el, type: 'blur' },
          });
        } catch { /* fall through */ }
      }
    }

    el.blur();
    // Real focusout (bubbling) — AK Atlassian's TextField wrappers and
    // RHF's `Controller` listen for the bubbling focusout, not the
    // non-bubbling blur. Dispatching both covers both paths.
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: false }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: false }));

    // Definitively shift focus to body so the field's wrapper sees a
    // "focus moved away" transition, which is what some autosave
    // implementations require before flushing.
    try { document.body.focus(); } catch { /* noop */ }

    // Longer wait for any debounced autosave to flush before the next
    // fill steals focus. Studio's autosave debounce can be ~1s — the
    // old 400ms wait often returned before the mutation actually went
    // out, so subagents saved as "Untitled" with empty triggers.
    await sleep(1200);

    return null;
  }

  /**
   * Click an element by invoking React's onClick handler(s) directly via
   * the fiber tree, rather than relying on `element.click()` or dispatched
   * MouseEvents.
   *
   * Why this exists: Studio's natural-language create page uses an AK /
   * Pragmatic button whose navigation handler is bound through React but
   * is NOT triggered by a synthetic `click` event in MV3 content-script
   * land. `element.click()` updates focus and fires the DOM click event,
   * but the handler never runs — verified live by walking the fiber and
   * invoking the handlers manually, which DID navigate. Dispatching
   * pointerdown/pointerup/click events alone also failed.
   *
   * The workaround is to find every `onClick` prop attached anywhere on
   * the fiber chain (button itself + all ancestor components) and call
   * them with a React-event-shaped object. Calling all of them is safe:
   * navigation handlers are idempotent (re-firing after the route already
   * changed is a no-op), and other handlers in the chain are
   * presentational (focus / hover state).
   *
   * Used selectively from the isolated world for buttons that don't
   * respond to a plain `.click()`. The vanilla `click()` helper in
   * dom-helpers.ts still works for every other button in the flow.
   */
  function clickReact(selector: string): { error: string | null; data?: unknown } {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return { error: 'clickReact: element not found for selector ' + selector };

    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!fiberKey) {
      return { error: 'clickReact: no React fiber on element (selector ' + selector + ')' };
    }

    type Fiber = {
      memoizedProps?: Record<string, unknown> | null;
      pendingProps?: Record<string, unknown> | null;
      type?: unknown;
      return?: Fiber | null;
    };

    const handlers: Array<{ depth: number; type: string; onClick: (e: unknown) => void }> = [];
    let node: Fiber | null = (el as unknown as Record<string, Fiber | null>)[fiberKey] ?? null;
    let depth = 0;
    while (node && depth < 20) {
      const props = node.memoizedProps ?? node.pendingProps;
      const onClick = props && (props as { onClick?: unknown }).onClick;
      if (typeof onClick === 'function') {
        const t = node.type as unknown;
        let typeName = 'unknown';
        if (typeof t === 'string') typeName = t;
        else if (t && typeof t === 'object') {
          typeName = String(
            (t as { displayName?: string; name?: string }).displayName
              ?? (t as { displayName?: string; name?: string }).name
              ?? 'Component',
          );
        } else if (typeof t === 'function') {
          typeName = (t as { displayName?: string; name?: string }).displayName
            ?? (t as { displayName?: string; name?: string }).name
            ?? 'Component';
        }
        handlers.push({ depth, type: typeName, onClick: onClick as (e: unknown) => void });
      }
      node = node.return ?? null;
      depth++;
    }

    if (handlers.length === 0) {
      return { error: 'clickReact: no onClick handlers on fiber chain (selector ' + selector + ')' };
    }

    // Build a React-event-shaped synthetic event. Include `nativeEvent`
    // because some handlers (router links, analytics wrappers) read from it.
    const nativeEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
    });
    const syntheticEvent = {
      target: el,
      currentTarget: el,
      type: 'click',
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      eventPhase: 2,
      isTrusted: false,
      button: 0,
      buttons: 0,
      nativeEvent,
      preventDefault() { /* noop */ },
      stopPropagation() { /* noop */ },
      persist() { /* noop */ },
      isDefaultPrevented() { return false; },
      isPropagationStopped() { return false; },
    };

    const invoked: Array<{ depth: number; type: string; error?: string }> = [];
    for (const h of handlers) {
      try {
        h.onClick(syntheticEvent);
        invoked.push({ depth: h.depth, type: h.type });
      } catch (e) {
        invoked.push({
          depth: h.depth,
          type: h.type,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { error: null, data: { handlersInvoked: invoked.length, invoked } };
  }

  async function dispatch(
    req: RovoPageWorldRequest,
  ): Promise<{ error: string | null; data?: unknown }> {
    switch (req.op) {
      case 'ping':
        return { error: null, data: { installed: true, version: PAGE_WORLD_VERSION } };
      case 'fillAkEditor':
        if (typeof req.selector !== 'string' || typeof req.text !== 'string') {
          return { error: 'fillAkEditor requires selector and text strings' };
        }
        return await fillAkEditor(req.selector, req.text);
      case 'fillNative':
        if (typeof req.selector !== 'string' || typeof req.text !== 'string') {
          return { error: 'fillNative requires selector and text strings' };
        }
        return { error: await fillNative(req.selector, req.text) };
      case 'clickReact':
        if (typeof req.selector !== 'string') {
          return { error: 'clickReact requires selector string' };
        }
        return clickReact(req.selector);
      case 'getScenarioIds':
        return {
          error: null,
          data: { ids: [...(W.__rovoSeenScenarioIds ?? [])] },
        };
      default:
        return { error: 'unknown op: ' + req.op };
    }
  }

  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data;
    if (
      !data
      || typeof data !== 'object'
      || (data as { __rovoPageWorldRequest?: unknown }).__rovoPageWorldRequest !== true
    ) {
      return;
    }
    const req = data as RovoPageWorldRequest;
    dispatch(req)
      .catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      }))
      .then((result: { error: string | null; data?: unknown }) => {
        const resp: RovoPageWorldResponse = {
          __rovoPageWorldResponse: true,
          id: req.id,
          error: result.error,
          data: result.data,
        };
        window.postMessage(resp, '*');
      });
  });
})();
