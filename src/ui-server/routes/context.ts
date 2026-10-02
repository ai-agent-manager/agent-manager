import path from 'node:path';
import { APP_VERSION } from '../../app-info.js';
import { getPlatform } from '../../lib/platform.js';
import { getSkillTools } from '../../config/tools.js';
import { sendJson } from '../http.js';
import { query } from '../validate.js';
import type { Router } from '../router.js';
import type { ContextDto } from '../api-types.js';

export function contextRoutes(router: Router, cwd: string, repoRoot: string | null): void {
  router.route('GET', '/api/context', (request) => {
    query(request.query, []);
    const dto: ContextDto = {
      appVersion: APP_VERSION, platform: getPlatform(), cwd, repoRoot,
      repoName: repoRoot ? path.basename(repoRoot) : null,
      tools: getSkillTools().map(({ id, name, note, repoNote }) => ({ id, name, note, repoNote })),
    };
    sendJson(request.res, 200, dto);
  });
}
