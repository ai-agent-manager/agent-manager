import { createServer, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkout } from './sandbox.js';
import { REDIRECT_URI } from '../../src/auth/callback-server.js';

/** A loopback publisher and OIDC provider. Exchanges validate state, redirect,
 * client and PKCE; no real account, network provider or application mock. */
export async function provider() {
  const archive = await readFile(path.join(checkout, 'tests/fixtures/version-bundle.zip'));
  const bearer = randomUUID(), refresh = randomUUID();
  let origin = '';
  const codes = new Map<string, { challenge: string; redirect: string }>();
  const attempts = new Map<string, URLSearchParams>();
  const control = { membershipFails: false, authorizationVisits: 0, exchanges: 0 };
  const json = (res: ServerResponse, value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  const server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url!, origin);
    if (url.pathname === '/.well-known/agents/discovery.json') return json(res, { version: '1',
      auth: { required: true, clientId: 'browser-test', oidcDiscoveryUrl: `${origin}/oidc` },
      projects: { enabled: true, exclusiveSource: true }, api: { baseUrl: `${origin}/api` },
      sources: [{ name: 'browser-fixture', type: 'http', url: `${origin}/agents` }] });
    if (url.pathname === '/oidc') return json(res, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token` });
    if (url.pathname === '/authorize') {
      control.authorizationVisits++;
      const params = url.searchParams;
      if (params.get('redirect_uri') !== REDIRECT_URI || params.get('client_id') !== 'browser-test' || params.get('code_challenge_method') !== 'S256' || params.get('response_type') !== 'code' || !params.get('state') || !params.get('code_challenge')) return json(res, { error: 'invalid_request' }, 400);
      const attempt = randomUUID(); attempts.set(attempt, params);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body><h1>Test identity provider</h1><form method="post" action="/approve"><input type="hidden" name="attempt" value="${attempt}"><button type="submit">Authorize test account</button></form></body></html>`); return;
    }
    if (url.pathname === '/approve' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const attempt = form.get('attempt')!, params = attempts.get(attempt); attempts.delete(attempt);
      if (!params) return json(res, { error: 'invalid_request' }, 400);
      const code = randomUUID(), redirect = params.get('redirect_uri')!;
      codes.set(code, { challenge: params.get('code_challenge')!, redirect });
      const callback = new URL(redirect); callback.searchParams.set('code', code); callback.searchParams.set('state', params.get('state')!);
      res.writeHead(303, { location: callback.href }); res.end(); return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString());
      const code = form.get('code')!, grant = codes.get(code); codes.delete(code);
      if (!grant || form.get('client_id') !== 'browser-test' || form.get('redirect_uri') !== grant.redirect || form.get('grant_type') !== 'authorization_code'
        || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== grant.challenge) return json(res, { error: 'invalid_grant' }, 400);
      control.exchanges++; return json(res, { access_token: bearer, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 });
    }
    if (req.headers.authorization !== `Bearer ${bearer}`) return json(res, { error: 'unauthorized' }, 401);
    if (url.pathname === '/api/projects') return control.membershipFails ? json(res, { error: 'membership unavailable' }, 503) : json(res, [{ id: 'example-project', teamId: 'example-team', name: 'Browser tests', toolIds: ['claude-code'], restrictSkills: true, allowedSkillIds: ['test-skill'], createdAt: '2026-01-01', updatedAt: '2026-01-01' }]);
    if (url.pathname === '/agents/index.json') return json(res, { lastUpdated: '2026-01-01', agents: [{ version: '0.1.0', published: '2026-01-01' }] });
    if (url.pathname === '/agents/0.1.0/bundle.zip') { res.end(archive); return; }
    if (url.pathname === '/agents/0.1.0/bundle.zip.sha256') { res.end(createHash('sha256').update(archive).digest('hex')); return; }
    json(res, { error: 'not_found' }, 404);
  })().catch(() => { res.writeHead(500); res.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url: origin, control, bearer, refresh, async close() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}
