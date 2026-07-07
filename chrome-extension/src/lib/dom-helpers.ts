/**
 * DOM helper functions that mirror Playwright's locator API using native
 * browser DOM APIs. These are designed for use within a content script
 * running on studio.atlassian.com.
 */

// ---------------------------------------------------------------------------
// Wait utilities
// ---------------------------------------------------------------------------

/**
 * Wait for a specified number of milliseconds.
 */
export function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for an element matching the selector to appear in the DOM.
 * Polls every 200ms up to the specified timeout.
 *
 * @throws Error if the element is not found within the timeout.
 */
export async function waitForSelector(
  selector: string,
  timeout: number = 10_000
): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
    await waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for selector: ${selector}`);
}

/**
 * Wait for an element matching a function predicate to appear.
 * Polls every 200ms up to the specified timeout.
 */
export async function waitForElement(
  finder: () => HTMLElement | null,
  description: string,
  timeout: number = 10_000
): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = finder();
    if (el) return el;
    await waitForTimeout(200);
  }
  throw new Error(`Timed out waiting for element: ${description}`);
}

// ---------------------------------------------------------------------------
// Element finders (mirror Playwright's getByTestId, getByRole, etc.)
// ---------------------------------------------------------------------------

/**
 * Find an element by its `data-testid` attribute.
 */
export function getByTestId(testId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testId)}"]`);
}

/**
 * Find an element by its ARIA role and accessible name.
 * The `name` option supports string (exact) or RegExp (partial) matching.
 *
 * This queries elements with explicit `role` attributes as well as
 * elements with implicit roles based on their tag name.
 */
export function getByRole(
  role: string,
  options?: { name?: string | RegExp }
): HTMLElement | null {
  // Map roles to common HTML elements that have implicit roles
  const implicitSelectors: Record<string, string> = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"]',
    textbox: 'input[type="text"], input:not([type]), textarea, [role="textbox"], [contenteditable="true"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    menuitem: '[role="menuitem"]',
    link: 'a[href], [role="link"]',
  };

  const selector = implicitSelectors[role] ?? `[role="${CSS.escape(role)}"]`;
  const candidates = document.querySelectorAll<HTMLElement>(selector);

  for (const el of candidates) {
    if (!options?.name) return el;

    const accessibleName = getAccessibleName(el);
    if (matchesName(accessibleName, options.name)) {
      return el;
    }
  }

  return null;
}

/**
 * Find all elements matching a role and optional name filter.
 */
export function getAllByRole(
  role: string,
  options?: { name?: string | RegExp }
): HTMLElement[] {
  const implicitSelectors: Record<string, string> = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"]',
    textbox: 'input[type="text"], input:not([type]), textarea, [role="textbox"], [contenteditable="true"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    menuitem: '[role="menuitem"]',
    link: 'a[href], [role="link"]',
  };

  const selector = implicitSelectors[role] ?? `[role="${CSS.escape(role)}"]`;
  const candidates = document.querySelectorAll<HTMLElement>(selector);
  const results: HTMLElement[] = [];

  for (const el of candidates) {
    if (!options?.name) {
      results.push(el);
      continue;
    }
    const accessibleName = getAccessibleName(el);
    if (matchesName(accessibleName, options.name)) {
      results.push(el);
    }
  }

  return results;
}

/**
 * Find elements by their placeholder text.
 */
export function getByPlaceholder(placeholder: string): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(`[placeholder="${CSS.escape(placeholder)}"]`)
  );
}

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

/**
 * Fill a form field with text. Clears existing content first.
 * Dispatches focus, input, change, and blur events to trigger
 * any framework-level handlers (React, etc.).
 */
export function fill(element: HTMLElement, value: string): void {
  element.focus();

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    // Use the native setter to bypass React's synthetic event system
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype,
      'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (element.getAttribute('contenteditable') === 'true') {
    // For contenteditable elements (used by some rich text editors)
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
  }

  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Click an element.
 *
 * We deliberately call ONLY `element.click()` instead of dispatching a
 * `mousedown` / `mouseup` / `click` sequence. Atlassian Design System
 * dropdown triggers (e.g. the "Create an agent" button) toggle on
 * `mousedown`: dispatching a synthetic `mousedown` opens the menu, and
 * the subsequent `.click()` is interpreted as a second toggle that
 * immediately closes it. The menu items then never appear, so the
 * provisioner times out waiting for `create-rovo-agent-menu-item`.
 *
 * `HTMLElement.prototype.click()` synthesises a trusted-like click that
 * AK Dropdown handles correctly without the toggle race.
 */
export function click(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center' });
  element.click();
}

/**
 * Press a key on the given element.
 */
export function pressKey(element: HTMLElement, key: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

/**
 * Check a checkbox element.
 */
export function check(element: HTMLElement): void {
  if (element instanceof HTMLInputElement && !element.checked) {
    click(element);
  }
}

/**
 * Uncheck a checkbox element.
 */
export function uncheck(element: HTMLElement): void {
  if (element instanceof HTMLInputElement && element.checked) {
    click(element);
  }
}

// ---------------------------------------------------------------------------
// Try-with-fallback pattern (mirrors RovoProvisioner's try/catch approach)
// ---------------------------------------------------------------------------

/**
 * Try the primary action, falling back to an alternative if it fails.
 * This mirrors the Playwright provisioner's pattern of trying a testid
 * selector first, then falling back to a role-based selector.
 */
export async function tryWithFallback(
  primary: () => void | Promise<void>,
  fallback: () => void | Promise<void>
): Promise<void> {
  try {
    await primary();
  } catch {
    await fallback();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the accessible name of an element using heuristics.
 * Checks aria-label, aria-labelledby, inner text, title, and placeholder.
 */
function getAccessibleName(el: HTMLElement): string {
  // aria-label takes highest priority
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }

  // For inputs, check associated <label>
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent?.trim() ?? '';
    }
    // Placeholder as fallback for inputs
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
  }

  // Inner text content
  const text = el.textContent?.trim();
  if (text) return text;

  // Title attribute
  const title = el.getAttribute('title');
  if (title) return title;

  return '';
}

/**
 * Match an accessible name against a string or RegExp.
 */
function matchesName(accessibleName: string, name: string | RegExp): boolean {
  if (typeof name === 'string') {
    return accessibleName.toLowerCase().includes(name.toLowerCase());
  }
  return name.test(accessibleName);
}
