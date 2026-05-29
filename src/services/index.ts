// Confluence service
export { ConfluenceService } from './confluence/ConfluenceService.js';
export { PlaywrightConfluenceClient } from './confluence/PlaywrightConfluenceClient.js';
export { markdownToConfluenceStorage, applyInlineFormatting } from './confluence/markdown.js';
export type {
  KnowledgePage,
  KnowledgeBaseStrategy,
  ExistingKnowledgeBase,
  ConfluenceClient,
  ConfluenceResponse,
} from './confluence/types.js';

// Studio service
export { StudioService } from './studio/StudioService.js';
export { substituteKbFilenames, applyKbUrlSubstitutions } from './studio/substitutions.js';
export type { CreateAgentResult } from './studio/types.js';
