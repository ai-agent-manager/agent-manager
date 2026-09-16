import { addSource, classifyStoredSource, readConfig, removeSource, setActiveSource } from '../../bundle/cache.js';
import { withMutation } from '../../lib/mutation.js';
import { sourceDto } from '../dto.js';
import { readJsonBody, sendJson, requestMutation } from '../http.js';
import { ConflictError } from '../errors.js';
import * as v from '../validate.js';
import type { Router } from '../router.js';
import type { SessionStore } from '../session-store.js';

async function sources() {
  const config = await readConfig();
  return { sources: (config.sources ?? []).map(sourceDto), active: config.activeSource ? sourceDto(config.activeSource) : null };
}
export function sourceRoutes(router: Router, sessions: SessionStore): void {
  router.route('GET', '/api/sources', async ({ res, query }) => { v.query(query, []); sendJson(res, 200, await sources()); });
  router.route('POST', '/api/sources', async ({ req, res, query }) => {
    v.query(query, []);
    const body = v.object(await readJsonBody(req), ['value', 'activate']);
    const source = classifyStoredSource(sessions.normaliseInput(v.string(body.value, 'value')));
    const activate = v.boolean(body.activate, 'activate') ?? false;
    await requestMutation(res, () => sessions.changeSource(() => addSource(source, { setActive: activate }), activate));
    sendJson(res, 200, await sources());
  });
  for (const action of ['remove', 'activate'] as const) {
    router.route('POST', `/api/sources/${action}`, async ({ req, res, query }) => {
      v.query(query, []);
      const body = v.object(await readJsonBody(req), ['kind', 'value']);
      const kind = v.choice(body.kind, 'kind', ['discovery', 'repo', 'directory']);
      const value = v.string(body.value, 'value');
      await requestMutation(res, () => sessions.changeSource(() => withMutation(async () => {
        // Match the displayed identity back to a server-owned stored value.
        const matches = (await readConfig()).sources?.filter((source) => source.kind === kind && sourceDto(source).value === value) ?? [];
        if (matches.length !== 1) throw new ConflictError('The source list changed. Refresh and retry.', 'SOURCE_CHANGED');
        await (action === 'remove' ? removeSource(matches[0]!) : setActiveSource(matches[0]!));
      }), true));
      sendJson(res, 200, await sources());
    });
  }
}
