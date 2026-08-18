import { Ajv2020 } from 'ajv/dist/2020.js';
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
  // sources into one namespace. JSON Schema cannot express uniqueness across a
  // property of array items, so it is checked here.
  const duplicates = [
    ...new Set(
      body.sources
        .map((source) => source.name)
        .filter((name, index, names) => names.indexOf(name) !== index),
    ),
  ];
  if (duplicates.length > 0) {
    throw new DiscoveryError(
      `Discovery document has duplicate source names: ${duplicates.join(', ')}`,
      baseUrl,
    );
  }

  return body;
}
