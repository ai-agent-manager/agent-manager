import { readJsonBody, sendJson } from '../http.js';
import * as v from '../validate.js';
import type { Router } from '../router.js';
import type { JobRegistry } from '../jobs.js';
import type { SseHub } from '../sse.js';

export function jobRoutes(router: Router, jobs: JobRegistry, events: SseHub): void {
  router.route('GET', '/api/jobs/:id', ({ res, params, query }) => {
    v.query(query, []); sendJson(res, 200, jobs.get(v.identifier(params.id, 'id')));
  });
  router.route('POST', '/api/jobs/:id/cancel', async ({ req, res, params, query }) => {
    v.query(query, []); v.object(await readJsonBody(req), []);
    await jobs.cancel(v.identifier(params.id, 'id')); sendJson(res, 200, {});
  });
  router.route('GET', '/api/events', ({ res, query }) => { v.query(query, []); events.attach(res); });
}
