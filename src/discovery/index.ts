export { fetchDiscoveryDocument, DiscoveryError } from './fetcher.js';
export { importGitSkills, type GitImportResult } from './git-importer.js';
export { resolveDiscoverySkills, type ResolvedSources, type ResolvedSkill, type ResolveDiscoveryOptions } from './resolver.js';
export { buildCatalogue, filterCatalogue, type CatalogueEntry, type SkillCandidate } from './catalogue.js';
export type {
  DiscoveryDocument,
  DiscoveryAuth,
  DiscoverySource,
  SourceType,
  SourceStatus,
} from './types.js';
