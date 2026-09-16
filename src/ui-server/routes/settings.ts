import { getSettings, updateSettings } from '../../operations/settings.js';
import { readJsonBody, sendJson, requestMutation } from '../http.js';
import * as v from '../validate.js';
import type { Router } from '../router.js';

export function settingsRoutes(router: Router): void {
  router.route('GET', '/api/settings', async ({ res, query }) => { v.query(query, []); sendJson(res, 200, await getSettings()); });
  router.route('PATCH', '/api/settings', async ({ req, res, query }) => {
    v.query(query, []);
    const body = v.object(await readJsonBody(req), ['startupUpdateChecksDisabled', 'telemetryDisabled']);
    const patch = { startupUpdateChecksDisabled: v.boolean(body.startupUpdateChecksDisabled, 'startupUpdateChecksDisabled'),
      telemetryDisabled: v.boolean(body.telemetryDisabled, 'telemetryDisabled') };
    sendJson(res, 200, await requestMutation(res, () => updateSettings(patch)));
  });
}
