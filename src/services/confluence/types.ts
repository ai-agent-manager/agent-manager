import type { ProgressCallback } from '../../provisioners/types.js';

// ---------------------------------------------------------------------------
// Confluence page types
// ---------------------------------------------------------------------------

/** A Confluence page created from a knowledge-base `.md` file. */
export interface KnowledgePage {
  /** Page title (matches the filename without extension, or agent name for the parent page) */
  title: string;
  /** Full URL to the Confluence page */
  url: string;
}

/** Strategy for handling existing knowledge-base pages in Confluence. */
export type KnowledgeBaseStrategy = 'overwrite' | 'reuse';

/** Info about existing Confluence pages found for an agent's knowledge base. */
export interface ExistingKnowledgeBase {
  /** The parent page (folder) that already exists */
  parentPage: KnowledgePage;
  /** Child pages that already exist under the parent */
  childPages: KnowledgePage[];
}

// ---------------------------------------------------------------------------
// Abstract HTTP client for Confluence REST API
// ---------------------------------------------------------------------------

/** A minimal HTTP response shape returned by {@link ConfluenceClient}. */
export interface ConfluenceResponse {
  ok(): boolean;
  status(): number;
  json(): Promise<any>;
  text(): Promise<string>;
}

/**
 * Abstract HTTP client for Confluence REST API calls.
 *
 * Implementations may use Playwright's `BrowserContext.request` (piggybacking
 * on an SSO session), a direct REST client with API tokens, or a test mock.
 */
export interface ConfluenceClient {
  /**
   * Perform any setup needed before API calls (e.g. navigate to Confluence
   * to trigger SSO autologin).  Called once before a batch of API operations.
   */
  init(confluenceBaseUrl: string): Promise<void>;

  get(url: string): Promise<ConfluenceResponse>;

  post(url: string, data: Record<string, unknown>): Promise<ConfluenceResponse>;

  put(
    url: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<ConfluenceResponse>;
}

// ---------------------------------------------------------------------------
// Re-export ProgressCallback for convenience
// ---------------------------------------------------------------------------

export type { ProgressCallback };
