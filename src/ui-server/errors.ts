import { categoriseError } from '../telemetry.js';
import { AmbiguousIdentifierError, SkillNotFoundError } from '../operations/manage.js';
import { OperationCancelledError } from '../operations/cancellation.js';
import { OperationConflictError } from '../lib/mutation.js';
import { DiscoveryError } from '../discovery/fetcher.js';
import { IntegrityError } from '../bundle/downloader.js';
import { RovoAgentValidationError } from '../bundle/scanner.js';
import { OidcDiscoveryError } from '../auth/oidc.js';
import { AuthCancelledError, AuthFlowError } from '../auth/flow.js';
import { CallbackServerError } from '../auth/callback-server.js';
import { ApiError } from '../api/client.js';
import { installedDto, safeUrl, safeText } from './dto.js';
import type { ErrorDto } from './api-types.js';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message); this.name = 'HttpError';
  }
}
export class ValidationError extends HttpError {
  constructor(message: string) { super(400, message, 'INVALID_REQUEST'); this.name = 'ValidationError'; }
}
export class ConflictError extends HttpError {
  constructor(message: string, code = 'CONFLICT') { super(409, message, code); this.name = 'ConflictError'; }
}

export function serialiseError(error: unknown): { status: number; body: { error: ErrorDto } } {
  let status = 500;
  let message = 'The operation failed. Check the source and retry.';
  const extras: Partial<ErrorDto> = {};
  let known = true;
  if (error instanceof HttpError) { status = error.status; extras.code = error.code; }
  else if (error instanceof AmbiguousIdentifierError) { status = 409; extras.matches = error.matches.map(installedDto); }
  else if (error instanceof SkillNotFoundError) status = 404;
  else if (error instanceof OperationConflictError) { status = 409; extras.code = error.code; }
  else if (error instanceof AuthCancelledError || error instanceof OperationCancelledError) {
    status = 409; extras.code = 'CANCELLED';
  } else if (error instanceof CallbackServerError && /address already in use|EADDRINUSE/i.test(error.message)) {
    status = 409; extras.code = 'AUTH_BUSY';
    message = 'Another Agent Manager login may be active. Finish or cancel it, then retry.';
  } else if (error instanceof AuthFlowError || error instanceof CallbackServerError) status = 401;
  else if (error instanceof DiscoveryError) {
    status = 502; extras.baseUrl = safeUrl(error.baseUrl); extras.status = error.status;
  } else if (error instanceof IntegrityError) {
    status = 502; extras.expected = error.expected; extras.actual = error.actual;
  } else if (error instanceof OidcDiscoveryError) { status = 502; extras.url = safeUrl(error.url); }
  else if (error instanceof ApiError) status = error.status && error.status >= 400 && error.status <= 599 ? error.status : 502;
  else if (error instanceof RovoAgentValidationError) { status = 422; extras.errors = error.errors.map(safeText); }
  else known = false;
  if (known && error instanceof Error && extras.code !== 'AUTH_BUSY') message = safeText(error.message);
  return { status, body: { error: {
    name: known && error instanceof Error ? error.constructor.name : 'Error', message,
    category: categoriseError(error), ...extras,
  } } };
}
