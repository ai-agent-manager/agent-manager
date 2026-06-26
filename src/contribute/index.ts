import { validateSkillDirectory } from './validate.js';
import { contributeToRepo } from './git.js';
import { isGithubRepo, createDraftPr } from './pr.js';
import type { ValidationResult } from './validate.js';
import type { GitContributeResult, GitContributeError } from './git.js';
import type { PrOutcome } from './pr.js';

export interface ContributeResult {
  validated: ValidationResult;
  gitResult: GitContributeResult | GitContributeError;
  prOutcome: PrOutcome | null;
}

export async function contribute(
  skillDirPath: string,
  remoteUrl: string,
): Promise<ContributeResult> {
  // Step 1: Validate
  const validated = await validateSkillDirectory(skillDirPath);
  if (!validated.valid) {
    return { validated, gitResult: { error: `Validation failed: ${validated.errors.map((e) => e.message).join(', ')}` }, prOutcome: null };
  }

  // Step 2: Clone, branch, copy, commit, push
  const gitResult = await contributeToRepo(remoteUrl, skillDirPath, validated.skillName!);
  if ('error' in gitResult) {
    return { validated, gitResult, prOutcome: null };
  }

  // Step 3: Offer PR creation for GitHub repos
  let prOutcome: PrOutcome | null = null;
  if (isGithubRepo(remoteUrl)) {
    prOutcome = await createDraftPr(remoteUrl, gitResult.branchName, validated.skillName!, validated.description!);
  }

  return { validated, gitResult, prOutcome };
}
