import { readFile } from 'node:fs/promises';
import type {
  ConfluenceClient,
  KnowledgePage,
  ExistingKnowledgeBase,
  ProgressCallback,
} from './types.js';
import type { KnowledgeBaseFile } from '../../bundle/scanner.js';
import { markdownToConfluenceStorage } from './markdown.js';

/**
 * Service for managing knowledge-base content in Confluence.
 *
 * All Confluence REST API calls are made through the injected
 * {@link ConfluenceClient}, making this service testable without Playwright.
 */
export class ConfluenceService {
  private client: ConfluenceClient;
  private log: ProgressCallback;

  constructor(client: ConfluenceClient, onProgress?: ProgressCallback) {
    this.client = client;
    this.log = onProgress ?? (() => {});
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check whether knowledge-base pages already exist in Confluence for the
   * given agent.
   *
   * Returns `null` when no matching parent page exists, or an
   * {@link ExistingKnowledgeBase} with the parent and child page metadata.
   */
  async checkExistingKnowledgeBase(options: {
    confluenceBaseUrl: string;
    confluenceSpaceKey: string;
    agentName: string;
  }): Promise<ExistingKnowledgeBase | null> {
    const confluenceBaseUrl = options.confluenceBaseUrl.replace(/\/+$/, '');

    this.log('Checking for existing knowledge base pages...');
    await this.client.init(confluenceBaseUrl);

    // Resolve space ID
    const spaceId = await this.resolveSpaceId(confluenceBaseUrl, options.confluenceSpaceKey);
    if (!spaceId) return null;

    // Search for a page with the agent name in this space
    const searchResp = await this.client.get(
      `${confluenceBaseUrl}/wiki/api/v2/pages?spaceId=${spaceId}&title=${encodeURIComponent(options.agentName)}&limit=1`
    );
    if (!searchResp.ok()) return null;

    const searchData = await searchResp.json() as {
      results: Array<{ id: string; title: string; _links?: { webui?: string } }>;
    };
    if (searchData.results.length === 0) return null;

    const parentPage = searchData.results[0];
    const parentWebui = parentPage._links?.webui
      ?? `/wiki/spaces/${options.confluenceSpaceKey}/pages/${parentPage.id}`;
    const parentKnowledge: KnowledgePage = {
      title: parentPage.title,
      url: `${confluenceBaseUrl}${parentWebui}`,
    };

    // Fetch child pages using v1 REST API (more reliable than v2 children endpoint)
    const childResp = await this.client.get(
      `${confluenceBaseUrl}/wiki/rest/api/content/${parentPage.id}/child/page?limit=50&expand=version`
    );

    const childPages: KnowledgePage[] = [];
    if (childResp.ok()) {
      const childData = await childResp.json() as {
        results: Array<{ id: string; title: string; _links?: { webui?: string } }>;
      };
      for (const child of childData.results) {
        const childWebui = child._links?.webui
          ?? `/wiki/spaces/${options.confluenceSpaceKey}/pages/${child.id}`;
        childPages.push({
          title: child.title,
          url: `${confluenceBaseUrl}${childWebui}`,
        });
      }
    } else {
      return { parentPage: parentKnowledge, childPages: [] };
    }

    return { parentPage: parentKnowledge, childPages };
  }

  /**
   * Upload the agent's knowledge-base `.md` files to Confluence.
   *
   * Creates (or updates) a parent page named after the agent in the given
   * space, then creates (or updates) one child page per `.md` file, converting
   * the Markdown content to Confluence storage format.
   *
   * Returns a `KnowledgePage[]` where the first entry is the parent folder
   * page and the remaining entries are the individual content pages.
   */
  async uploadKnowledgeBase(options: {
    confluenceBaseUrl: string;
    confluenceSpaceKey: string;
    agentName: string;
    files: KnowledgeBaseFile[];
    overwrite?: ExistingKnowledgeBase;
  }): Promise<KnowledgePage[]> {
    const { confluenceBaseUrl, confluenceSpaceKey, agentName, files } = options;

    this.log('Connecting to Confluence...');
    await this.client.init(confluenceBaseUrl);

    // Resolve space ID from space key
    const spaceId = await this.resolveSpaceId(confluenceBaseUrl, confluenceSpaceKey);
    if (!spaceId) {
      throw new Error(`Confluence space with key "${confluenceSpaceKey}" was not found`);
    }

    if (options.overwrite) {
      return this.overwritePages(confluenceBaseUrl, confluenceSpaceKey, spaceId, agentName, files, options.overwrite);
    } else {
      return this.createPages(confluenceBaseUrl, confluenceSpaceKey, spaceId, agentName, files);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve a Confluence space key to its internal space ID.
   * Returns `null` if the space is not found.
   */
  private async resolveSpaceId(
    confluenceBaseUrl: string,
    spaceKey: string,
  ): Promise<string | null> {
    const spacesResp = await this.client.get(
      `${confluenceBaseUrl}/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`
    );
    if (!spacesResp.ok()) return null;

    const spacesData = await spacesResp.json() as { results: Array<{ id: string }> };
    if (spacesData.results.length === 0) return null;
    return spacesData.results[0].id;
  }

  /**
   * Fetch the current version number of a Confluence page by its ID.
   * Tries the v1 REST API first, then falls back to v2.
   */
  private async getPageVersion(
    confluenceBaseUrl: string,
    pageId: string,
  ): Promise<number> {
    // v1 API — reliably includes version
    try {
      const v1Resp = await this.client.get(
        `${confluenceBaseUrl}/wiki/rest/api/content/${pageId}?expand=version`
      );
      if (v1Resp.ok()) {
        const v1Data = await v1Resp.json() as { version?: { number: number } };
        if (v1Data.version?.number) {
          return v1Data.version.number;
        }
      }
    } catch { /* fall through */ }

    // v2 API fallback
    try {
      const v2Resp = await this.client.get(
        `${confluenceBaseUrl}/wiki/api/v2/pages/${pageId}`
      );
      if (v2Resp.ok()) {
        const v2Data = await v2Resp.json() as { version?: { number: number } };
        if (v2Data.version?.number) {
          return v2Data.version.number;
        }
      }
    } catch { /* fall through */ }

    return 1;
  }

  /**
   * Overwrite mode: update existing parent and child pages.
   */
  private async overwritePages(
    confluenceBaseUrl: string,
    confluenceSpaceKey: string,
    spaceId: string,
    agentName: string,
    files: KnowledgeBaseFile[],
    existing: ExistingKnowledgeBase,
  ): Promise<KnowledgePage[]> {
    this.log(`Updating existing knowledge base folder "${agentName}" in Confluence...`);
    const pages: KnowledgePage[] = [];

    // Look up the parent page to get its ID
    const searchResp = await this.client.get(
      `${confluenceBaseUrl}/wiki/api/v2/pages?spaceId=${spaceId}&title=${encodeURIComponent(agentName)}&limit=1`
    );
    if (!searchResp.ok()) {
      throw new Error(`Cannot overwrite: failed to search for page "${agentName}": HTTP ${searchResp.status()}`);
    }
    const searchData = await searchResp.json() as {
      results: Array<{ id: string; _links?: { webui?: string } }>;
    };
    if (searchData.results.length === 0) {
      throw new Error(`Cannot overwrite: parent page "${agentName}" not found in space "${confluenceSpaceKey}"`);
    }
    const parentId = searchData.results[0].id;

    // Update the parent page
    const parentVersion = await this.getPageVersion(confluenceBaseUrl, parentId);
    const updateTimestamp = new Date().toISOString();
    const updateResp = await this.client.put(
      `${confluenceBaseUrl}/wiki/rest/api/content/${parentId}`,
      {
        type: 'page',
        title: agentName,
        version: {
          number: parentVersion + 1,
          message: `Updated by agentman at ${updateTimestamp}`,
        },
        body: {
          storage: {
            representation: 'storage',
            value: `<p>Knowledge base pages for the <strong>${agentName}</strong> Rovo agent.</p><p><em>Last updated: ${updateTimestamp}</em></p>`,
          },
        },
      },
      { 'X-Atlassian-Token': 'no-check' },
    );

    if (updateResp.ok()) {
      const updatedData = await updateResp.json() as { id: string; _links?: { webui?: string } };
      const webui = updatedData._links?.webui ?? `/wiki/spaces/${confluenceSpaceKey}/pages/${parentId}`;
      pages.push({ title: agentName, url: `${confluenceBaseUrl}${webui}` });
    } else {
      const body = await updateResp.text();
      this.log(`Warning: failed to update parent page: HTTP ${updateResp.status()} — ${body}`);
      pages.push(existing.parentPage);
    }

    // Build maps of existing children
    const existingChildMap = new Map<string, KnowledgePage>();
    for (const child of existing.childPages) {
      existingChildMap.set(child.title, child);
    }

    const childListResp = await this.client.get(
      `${confluenceBaseUrl}/wiki/rest/api/content/${parentId}/child/page?limit=50`
    );
    const childIdMap = new Map<string, string>();
    if (childListResp.ok()) {
      const childListData = await childListResp.json() as {
        results: Array<{ id: string; title: string }>;
      };
      for (const child of childListData.results) {
        childIdMap.set(child.title, child.id);
      }
    } else {
      this.log(`Warning: could not list child pages — will create new pages instead.`);
    }

    // Update or create each child page
    for (const file of files) {
      this.log(`Updating "${file.title}" in Confluence...`);
      const content = await this.readFileContent(file);
      if (content === null) continue;

      const existingChildId = childIdMap.get(file.title);
      if (existingChildId) {
        const childPage = await this.updateChildPage(
          confluenceBaseUrl, confluenceSpaceKey, existingChildId, file.title, content,
        );
        if (childPage) {
          pages.push(childPage);
        } else {
          const existing = existingChildMap.get(file.title);
          if (existing) pages.push(existing);
        }
      } else {
        const childPage = await this.createChildPage(
          confluenceBaseUrl, spaceId, parentId, file.title, content,
        );
        if (childPage) pages.push(childPage);
      }
    }

    return pages;
  }

  /**
   * Create mode: create new parent page and child pages.
   */
  private async createPages(
    confluenceBaseUrl: string,
    confluenceSpaceKey: string,
    spaceId: string,
    agentName: string,
    files: KnowledgeBaseFile[],
  ): Promise<KnowledgePage[]> {
    this.log(`Creating knowledge base folder "${agentName}" in Confluence...`);
    const pages: KnowledgePage[] = [];

    const parentResp = await this.client.post(`${confluenceBaseUrl}/wiki/api/v2/pages`, {
      spaceId,
      status: 'current',
      title: agentName,
      body: {
        representation: 'storage',
        value: `<p>Knowledge base pages for the <strong>${agentName}</strong> Rovo agent.</p>`,
      },
    });
    if (!parentResp.ok()) {
      const body = await parentResp.text();
      throw new Error(
        `Failed to create parent Confluence page "${agentName}": HTTP ${parentResp.status()} — ${body}`
      );
    }
    const parentData = await parentResp.json() as { id: string; _links: { webui: string } };
    const parentId = parentData.id;
    pages.push({ title: agentName, url: `${confluenceBaseUrl}${parentData._links.webui}` });

    // Create one child page per .md file
    for (const file of files) {
      this.log(`Uploading "${file.title}" to Confluence...`);
      const content = await this.readFileContent(file);
      if (content === null) continue;

      const childPage = await this.createChildPage(
        confluenceBaseUrl, spaceId, parentId, file.title, content,
      );
      if (childPage) pages.push(childPage);
    }

    return pages;
  }

  /** Read a knowledge-base file, logging a warning and returning null on failure. */
  private async readFileContent(file: KnowledgeBaseFile): Promise<string | null> {
    try {
      return await readFile(file.filePath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`Warning: skipping "${file.title}" — could not read file: ${msg}`);
      return null;
    }
  }

  /** Create a new child page under a parent. Returns the page info or null on failure. */
  private async createChildPage(
    confluenceBaseUrl: string,
    spaceId: string,
    parentId: string,
    title: string,
    markdownContent: string,
  ): Promise<KnowledgePage | null> {
    const resp = await this.client.post(`${confluenceBaseUrl}/wiki/api/v2/pages`, {
      spaceId,
      parentId,
      status: 'current',
      title,
      body: {
        representation: 'storage',
        value: markdownToConfluenceStorage(markdownContent),
      },
    });
    if (!resp.ok()) {
      const body = await resp.text();
      this.log(`Warning: failed to create "${title}": HTTP ${resp.status()} — ${body}`);
      return null;
    }
    const data = await resp.json() as { id: string; _links: { webui: string } };
    return { title, url: `${confluenceBaseUrl}${data._links.webui}` };
  }

  /** Update an existing child page. Returns the updated page info or null on failure. */
  private async updateChildPage(
    confluenceBaseUrl: string,
    confluenceSpaceKey: string,
    pageId: string,
    title: string,
    markdownContent: string,
  ): Promise<KnowledgePage | null> {
    const version = await this.getPageVersion(confluenceBaseUrl, pageId);
    const timestamp = new Date().toISOString();

    const resp = await this.client.put(
      `${confluenceBaseUrl}/wiki/rest/api/content/${pageId}`,
      {
        type: 'page',
        title,
        version: {
          number: version + 1,
          message: `Updated by agentman at ${timestamp}`,
        },
        body: {
          storage: {
            representation: 'storage',
            value: markdownToConfluenceStorage(markdownContent),
          },
        },
      },
      { 'X-Atlassian-Token': 'no-check' },
    );
    if (!resp.ok()) {
      const body = await resp.text();
      this.log(`Warning: failed to update "${title}": HTTP ${resp.status()} — ${body}`);
      return null;
    }
    const data = await resp.json() as { id: string; _links?: { webui?: string } };
    const webui = data._links?.webui ?? `/wiki/spaces/${confluenceSpaceKey}/pages/${pageId}`;
    return { title, url: `${confluenceBaseUrl}${webui}` };
  }
}
