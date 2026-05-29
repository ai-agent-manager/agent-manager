import type { ConfluenceClient, ConfluenceResponse } from './types.js';

/**
 * {@link ConfluenceClient} implementation that uses Playwright's
 * `BrowserContext.request` API for HTTP calls.
 *
 * This piggybacks on the browser's SSO session — once the page navigates to
 * the Confluence domain (triggering autologin), subsequent `context.request`
 * calls carry the correct session cookies automatically.
 */
export class PlaywrightConfluenceClient implements ConfluenceClient {
  private page: import('playwright').Page;
  private context: import('playwright').BrowserContext;

  constructor(page: import('playwright').Page, context: import('playwright').BrowserContext) {
    this.page = page;
    this.context = context;
  }

  /**
   * Navigate to the Confluence wiki root to trigger SSO autologin, ensuring
   * subsequent API calls carry the correct session cookies.
   */
  async init(confluenceBaseUrl: string): Promise<void> {
    await this.page.goto(`${confluenceBaseUrl}/wiki`);
    await this.page.waitForLoadState('networkidle');
  }

  async get(url: string): Promise<ConfluenceResponse> {
    const resp = await this.context.request.get(url);
    return wrapResponse(resp);
  }

  async post(url: string, data: Record<string, unknown>): Promise<ConfluenceResponse> {
    const resp = await this.context.request.post(url, { data });
    return wrapResponse(resp);
  }

  async put(
    url: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<ConfluenceResponse> {
    const resp = await this.context.request.put(url, {
      data,
      headers: headers
        ? { 'Content-Type': 'application/json', ...headers }
        : { 'Content-Type': 'application/json' },
    });
    return wrapResponse(resp);
  }
}

/** Wrap Playwright's APIResponse to match our minimal {@link ConfluenceResponse} interface. */
function wrapResponse(resp: import('playwright').APIResponse): ConfluenceResponse {
  return {
    ok: () => resp.ok(),
    status: () => resp.status(),
    json: () => resp.json(),
    text: () => resp.text(),
  };
}
