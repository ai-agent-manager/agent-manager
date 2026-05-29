import type { KnowledgePage } from '../confluence/types.js';

/** Result returned by the Studio agent creation flow. */
export interface CreateAgentResult {
  /**
   * Knowledge base pages uploaded to Confluence.
   * Empty when no `confluenceBaseUrl`/`confluenceSpaceKey` was supplied or no
   * `assets/knowledge-base/` files exist for the agent.
   */
  knowledgePages: KnowledgePage[];
}
