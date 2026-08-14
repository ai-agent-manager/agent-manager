export { fetchDiscoveryDocument, DiscoveryError } from './fetcher.js';
export { importGitSkills, type GitImportResult } from './git-importer.js';
export { resolveDiscoverySkills, type ResolvedSources, type ResolvedSkill, type ResolveDiscoveryOptions } from './resolver.js';
export {
  buildCatalogue,
  buildRovoCatalogue,
  buildUnifiedCatalogue,
  filterCatalogue,
  type CatalogueEntry,
  type SkillCatalogueEntry,
  type RovoCatalogueEntry,
  type SkillCandidate,
} from './catalogue.js';
export type {
  DiscoveryDocument,
  DiscoveryAuth,
  DiscoverySource,
  HttpDiscoverySource,
  GitDiscoverySource,
  ArtefactDiscoverySource,
  SourceType,
  SourceStatus,
} from './types.js';
