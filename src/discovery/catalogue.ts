/**
 * Group discovery-resolved skills into a skill-first catalogue: one entry per
 * skill identity, each listing every source that offers it. The source picker
 * is where the user disambiguates; install identity stays (skillId + namespace)
 * via deriveSkillInstallKey, so candidates never collide on disk.
 */

import { deriveSkillInstallKey } from '../bundle/skill-source.js';
import type { ResolvedSkill } from './resolver.js';
import type { RovoAgentInfo } from '../bundle/scanner.js';
import type { SourceType, SourceStatus } from './types.js';

export interface SkillCandidate {
  /** The resolved skill for this source — carries dirPath + sourcePin, ready to install. */
  skill: ResolvedSkill;
  sourceName: string;
  sourceType: SourceType;
  sourceStatus?: SourceStatus;
  /** Install key this candidate would produce, e.g. "github.com/org/repo/my-skill". */
  installKey: string;
}

interface BaseCatalogueEntry {
  /** Bare identity (directory name). */
  skillId: string;
  displayName: string;
  description: string;
  /**
   * When Search & Install is constrained by `projects.exclusiveSource`, the
   * names of membership projects that permit this item.
   */
  projectNames?: string[];
}

/** A skill entry: one identity offered by one or more installable sources. */
export interface SkillCatalogueEntry extends BaseCatalogueEntry {
  kind: 'skill';
  candidates: SkillCandidate[];
}

/** A Rovo agent entry: provisioned to Atlassian Studio, not installed locally. */
export interface RovoCatalogueEntry extends BaseCatalogueEntry {
  kind: 'rovo-agent';
  agent: RovoAgentInfo;
}

/**
 * A single row in the unified catalogue. The two kinds diverge sharply after
 * selection (skills install to a local path; Rovo agents provision to Studio),
 * so the entry carries a `kind` discriminator that callers branch on.
 */
export type CatalogueEntry = SkillCatalogueEntry | RovoCatalogueEntry;

const STATUS_RANK: Record<SourceStatus, number> = { official: 0, verified: 1, community: 2 };

function statusRank(status?: SourceStatus): number {
  return status !== undefined ? STATUS_RANK[status] : 3;
}

export function buildCatalogue(skills: ResolvedSkill[]): SkillCatalogueEntry[] {
  const entries = new Map<string, SkillCatalogueEntry>();

  for (const skill of skills) {
    const candidate: SkillCandidate = {
      skill,
      sourceName: skill.sourceName,
      sourceType: skill.sourceType,
      ...(skill.sourceStatus ? { sourceStatus: skill.sourceStatus } : {}),
      installKey: deriveSkillInstallKey(skill),
    };

    const existing = entries.get(skill.dirName);
    if (existing) {
      existing.candidates.push(candidate);
    } else {
      entries.set(skill.dirName, {
        kind: 'skill',
        skillId: skill.dirName,
        displayName: skill.meta?.name ?? skill.dirName,
        description: skill.meta?.description ?? '',
        candidates: [candidate],
      });
    }
  }

  for (const entry of entries.values()) {
    // Stable sort: official → verified → community → unlabeled, source order preserved within.
    entry.candidates.sort((a, b) => statusRank(a.sourceStatus) - statusRank(b.sourceStatus));
  }

  return [...entries.values()];
}

export function buildRovoCatalogue(agents: RovoAgentInfo[]): RovoCatalogueEntry[] {
  return agents.map((agent) => ({
    kind: 'rovo-agent',
    skillId: agent.dirName,
    displayName: agent.config.identity.name || agent.dirName,
    description: agent.config.identity.description ?? '',
    agent,
  }));
}

/**
 * Build the unified catalogue from skills and Rovo agents. A skill and an agent
 * that happen to share a directory name stay separate rows (keyed by kind), so
 * the two never collapse into one entry.
 */
export function buildUnifiedCatalogue(
  skills: ResolvedSkill[],
  agents: RovoAgentInfo[],
): CatalogueEntry[] {
  return [...buildCatalogue(skills), ...buildRovoCatalogue(agents)];
}

export function filterCatalogue(entries: CatalogueEntry[], query: string): CatalogueEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return entries;

  return entries.filter((entry) => {
    if (
      entry.displayName.toLowerCase().includes(q) ||
      entry.skillId.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q)
    ) {
      return true;
    }
    return entry.kind === 'skill' && entry.candidates.some((c) => c.sourceName.toLowerCase().includes(q));
  });
}
