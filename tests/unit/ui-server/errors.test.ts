import { expect, it } from 'vitest';
import { serialiseError, ValidationError, ConflictError } from '../../../src/ui-server/errors.js';
import { AmbiguousIdentifierError, SkillNotFoundError } from '../../../src/operations/manage.js';
import { OperationCancelledError } from '../../../src/operations/cancellation.js';
import { OperationConflictError } from '../../../src/lib/mutation.js';
import { AuthCancelledError, AuthFlowError } from '../../../src/auth/flow.js';
import { CallbackServerError } from '../../../src/auth/callback-server.js';
import { DiscoveryError } from '../../../src/discovery/fetcher.js';
import { IntegrityError } from '../../../src/bundle/downloader.js';
import { OidcDiscoveryError } from '../../../src/auth/oidc.js';
import { ApiError } from '../../../src/api/client.js';
import { RovoAgentValidationError } from '../../../src/bundle/scanner.js';
import { isAuthorised } from '../../../src/server/auth.js';
import { safeText } from '../../../src/ui-server/dto.js';
import type { IncomingMessage } from 'node:http';

it.each([
  [new AmbiguousIdentifierError('skill', []), 409], [new SkillNotFoundError('skill'), 404],
  [new OperationCancelledError(), 409], [new OperationConflictError('busy'), 409],
  [new AuthCancelledError(), 409], [new AuthFlowError('Sign in again'), 401],
  [new DiscoveryError('Unavailable', 'https://example.com'), 502],
  [new IntegrityError('expected', 'actual'), 502], [new OidcDiscoveryError('Unavailable', 'https://example.com'), 502],
  [new ApiError('Denied', 403, 'secret upstream body'), 403],
  [new RovoAgentValidationError(['invalid config']), 422],
  [new ValidationError('Invalid scope'), 400], [new ConflictError('Changed', 'STALE_SESSION'), 409],
  [new Error('secret internal implementation detail'), 500],
])('maps %s to a safe %d envelope', (error, status) => {
  const result = serialiseError(error);
  expect(result.status).toBe(status);
  expect(result.body.error).toHaveProperty('category');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('stack');
});

it('classifies callback port contention as an actionable conflict', () => {
  expect(serialiseError(new CallbackServerError('listen EADDRINUSE'))).toMatchObject({ status: 409, body: { error: { code: 'AUTH_BUSY', message: expect.stringContaining('Another Agent Manager login') } } });
});

it('redacts URL credentials and token query parameters from error metadata', () => {
  const dto = serialiseError(new DiscoveryError('Failed https://user:secret@example.com/path?token=secret', 'https://user:secret@example.com/path?token=secret', new Error('secret')));
  expect(JSON.stringify(dto)).not.toContain('secret');
  expect(dto.body.error.baseUrl).toBe('https://example.com/path');
});

it('rejects Unicode bearer tokens without throwing on unequal byte lengths', () => {
  const req = { headers: { authorization: `Bearer ${'é'.repeat(36)}` } } as IncomingMessage;
  expect(isAuthorised(req, 'a'.repeat(36))).toBe(false);
});

it('omits upstream response bodies even when core includes them in the message', () => {
  expect(JSON.stringify(serialiseError(new ApiError('API error 401 for /projects: {"token":"secret"}', 401)))).not.toContain('secret');
  expect(JSON.stringify(serialiseError(new AuthFlowError('Token exchange failed (HTTP 401): {"token":"secret"}')))).not.toContain('secret');
  expect(safeText('Membership failed:\nAPI error 403 for /projects: body\nsecret')).not.toContain('secret');
});
