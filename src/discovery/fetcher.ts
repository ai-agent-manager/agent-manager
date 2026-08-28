import { Ajv2020 } from 'ajv/dist/2020.js';
import { deriveBundleSourceNamespace } from '../bundle/skill-source.js';
import _addFormats from 'ajv-formats';

// ajv-formats CJS interop: the default export is the function itself
// under NodeNext module resolution.
const addFormats = _addFormats as unknown as typeof _addFormats.default;
import schema from './schema.json' with { type: 'json' };
import type { DiscoveryDocument } from './types.js';

const WELL_KNOWN_PATH = '/.well-known/agents/discovery.json';

export class DiscoveryError extends Error {
  constructor(
    message: string,
    public readonly baseUrl: string,
    public readonly cause?: unknown,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

/**
 * Fetch and validate the discovery document from the well-known path.
 */
export async function fetchDiscoveryDocument(
  baseUrl: string,
  accessToken?: string,
): Promise<DiscoveryDocument> {
  const url = new URL(WELL_KNOWN_PATH, baseUrl).toString();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    throw new DiscoveryError(
      `Failed to fetch discovery document from ${url}`,
      baseUrl,
      err,
    );
  }

  if (!response.ok) {
    throw new DiscoveryError(
      `Discovery document not found at ${url} (HTTP ${response.status})`,
      baseUrl,
      undefined,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new DiscoveryError(
      `Discovery document at ${url} is not valid JSON`,
      baseUrl,
      err,
    );
  }

  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile<DiscoveryDocument>(schema);

  if (!validate(body)) {
    const errors = validate.errors
      ?.map((e: { instancePath?: string; message?: string }) =>
        `${e.instancePath || '/'}: ${e.message}`,
      )
      .join('; ');
    throw new DiscoveryError(
      `Discovery document validation failed: ${errors}`,
      baseUrl,
    );
  }

  // Source names are install identities, so duplicates would silently merge two
  // sources into one namespace and one cache directory. JSON Schema cannot
  // express uniqueness across a property of array items, so it is checked here.
  //
  // http names are compared on their derived namespace, because names differing
  // only in case or punctuation ("Team-Alpha" vs "team alpha") are distinct
  // strings that collapse to one identity. git and artefact sources derive
  // identity from their URLs instead, so their names are compared as written —
  // deriving a namespace for them would reject a document over a display name
  // that is never used as an identity.
  const seen = new Map<string, string>();
  for (const source of body.sources) {
    let key: string;
    try {
      key = source.type === 'http' ? deriveBundleSourceNamespace(source.name) : source.name;
    } catch (err) {
      throw new DiscoveryError(
        `Discovery document has an unusable source name: ${err instanceof Error ? err.message : String(err)}`,
        baseUrl,
      );
    }

    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new DiscoveryError(
        previous === source.name
          ? `Discovery document has duplicate source names: ${source.name}`
          : `Discovery document has source names that resolve to one identity: '${previous}' and '${source.name}' both become '${key}'`,
        baseUrl,
      );
    }
    seen.set(key, source.name);
  }

  return body;
}
