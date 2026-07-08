import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// A staging area that the mock git clone will copy from
let stagingDir: string;

// Mock execFile so the "clone" copies from staging → target
vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (_cmd: string, args: string[], _opts: unknown, cb: Function) => {
      const targetDir = args[args.length - 1];
      // Copy staging content into target dir to simulate a clone
      cp(stagingDir, targetDir, { recursive: true })
        .then(() => cb(null, '', ''))
        .catch((err: Error) => cb(err, '', ''));
    },
  ),
}));

// Mock getAgentmanDir to use a temp directory
let tempBase: string;
vi.mock('../../../src/config/paths.js', () => ({
  getAgentmanDir: () => tempBase,
}));

const { importGitSkills } = await import(
  '../../../src/discovery/git-importer.js'
);

describe('importGitSkills', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `git-importer-test-${Date.now()}`);
    tempBase = tempDir;
    stagingDir = path.join(tempDir, '_staging');
    await mkdir(stagingDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers skills in the skills/ directory', async () => {
    const skillDir = path.join(stagingDir, 'skills', 'quality-review');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\ndescription: Review code quality\n---\n\nReview the code.',
    );

    const result = await importGitSkills(
      'https://github.com/example/repo.git',
      'my-skill',
    );

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.dirName).toBe('quality-review');
    expect(result.clonePath).toBe(path.join(tempDir, 'git-cache', 'my-skill'));
  });

  it('discovers a root-level SKILL.md (single-skill plugin)', async () => {
    await writeFile(
      path.join(stagingDir, 'SKILL.md'),
      '---\ndescription: A single skill\n---\n\nDo something.',
    );

    const result = await importGitSkills(
      'https://github.com/example/single.git',
      'single-skill',
    );

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.dirName).toBe('single-skill');
  });

  it('discovers multiple skills', async () => {
    for (const name of ['skill-a', 'skill-b', 'skill-c']) {
      const dir = path.join(stagingDir, 'skills', name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'SKILL.md'), `# ${name}`);
    }

    const result = await importGitSkills(
      'https://github.com/example/multi.git',
      'multi',
    );

    expect(result.skills).toHaveLength(3);
    const names = result.skills.map((s) => s.dirName).sort();
    expect(names).toEqual(['skill-a', 'skill-b', 'skill-c']);
  });

  it('returns empty skills when no SKILL.md files exist', async () => {
    await writeFile(path.join(stagingDir, 'README.md'), '# No skills here');

    const result = await importGitSkills(
      'https://github.com/example/empty.git',
      'empty',
    );

    expect(result.skills).toHaveLength(0);
  });

  it('skips hidden directories in skills/', async () => {
    const hiddenDir = path.join(stagingDir, 'skills', '.hidden-skill');
    const visibleDir = path.join(stagingDir, 'skills', 'visible-skill');
    await mkdir(hiddenDir, { recursive: true });
    await mkdir(visibleDir, { recursive: true });
    await writeFile(path.join(hiddenDir, 'SKILL.md'), '# Hidden');
    await writeFile(path.join(visibleDir, 'SKILL.md'), '# Visible');

    const result = await importGitSkills(
      'https://github.com/example/hidden.git',
      'hidden',
    );

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]!.dirName).toBe('visible-skill');
  });
});
