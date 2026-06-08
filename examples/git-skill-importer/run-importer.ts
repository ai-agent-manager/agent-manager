/**
 * Smoke test: run the git skill importer against a local test plugin repo.
 *
 * Usage (from the project root):
 *   npx tsx examples/git-skill-importer/run-importer.ts [repo-url]
 *
 * Default repo URL: file:///tmp/test-plugin
 */
import { importGitSkills } from "../../src/discovery/git-importer.js";

const repoUrl = process.argv[2] ?? "file:///tmp/test-plugin";
const skillName = "test-plugin";

const result = await importGitSkills(repoUrl, skillName);

console.log("Skills found:", result.skills.length);
for (const s of result.skills) {
  console.log(`  - ${s.dirName}: ${s.meta?.description ?? "(no description)"}`);
}
console.log("Clone path:", result.clonePath);
