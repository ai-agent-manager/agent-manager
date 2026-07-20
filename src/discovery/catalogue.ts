/**
 * Group discovery-resolved skills into a skill-first catalogue: one entry per
 * skill identity, each listing every source that offers it. The source picker
 * is where the user disambiguates; install identity stays (skillId + namespace)
 * via deriveSkillInstallKey, so candidates never collide on disk.
 */

import { deriveSkillInstallKey } from '../bundle/skill-source.js';
import type { ResolvedSkill } from './resolver.js';
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

export interface CatalogueEntry {
  /** Bare skill identity (directory name). */
  skillId: string;
  displayName: string;
  description: string;
  candidates: SkillCandidate[];
}

const STATUS_RANK: Record<string, number> = { official: 0, community: 1 };

function statusRank(status?: SourceStatus): number {
  return status !== undefined ? STATUS_RANK[status] : 2;
}

export function buildCatalogue(skills: ResolvedSkill[]): CatalogueEntry[] {
  const entries = new Map<string, CatalogueEntry>();

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
        skillId: skill.dirName,
        displayName: skill.meta?.name ?? skill.dirName,
        description: skill.meta?.description ?? '',
        candidates: [candidate],
      });
    }
  }

  for (const entry of entries.values()) {
    // Stable sort: official → community → unlabeled, source order preserved within.
    entry.candidates.sort((a, b) => statusRank(a.sourceStatus) - statusRank(b.sourceStatus));
  }

  return [...entries.values()];
}

export function filterCatalogue(entries: CatalogueEntry[], query: string): CatalogueEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return entries;

  return entries.filter(
    (entry) =>
      entry.displayName.toLowerCase().includes(q) ||
      entry.skillId.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q) ||
      entry.candidates.some((c) => c.sourceName.toLowerCase().includes(q)),
  );
}
