import { readJsonBody, sendJson } from '../http.js';
import * as v from '../validate.js';
import type { Router } from '../router.js';
import type { SessionStore } from '../session-store.js';

export function sessionRoutes(router: Router, sessions: SessionStore): void {
  router.route('GET', '/api/session', ({ res, query }) => { v.query(query, []); sendJson(res, 200, sessions.snapshot()); });
  router.route('POST', '/api/session/load', async ({ req, res, query }) => {
    v.query(query, []);
    const body = v.object(await readJsonBody(req), ['source', 'forceUpdate']);
    const source = v.optionalString(body.source, 'source');
    const force = v.boolean(body.forceUpdate, 'forceUpdate');
    sendJson(res, 202, { jobId: await sessions.load(source, force) });
  });
  router.route('GET', '/api/auth', ({ res, query }) => { v.query(query, []); sendJson(res, 200, sessions.snapshot().auth); });
  router.route('POST', '/api/auth/logout', async ({ req, res, query }) => {
    v.query(query, []); v.object(await readJsonBody(req), []);
    await sessions.logout(); sendJson(res, 200, {});
  });
}
