import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { findRepoRoot } from '../lib/repo.js';
import { getToolById } from '../config/tools.js';
import { ValidationError } from './errors.js';

export function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Expected a JSON object.');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !allowed.includes(key))) throw new ValidationError('Unknown request field.');
  return result;
}
export function query(params: URLSearchParams, allowed: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw new ValidationError('Unknown or repeated query parameter.');
    result[key] = value;
  }
  return result;
}
export function string(value: unknown, field: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max
      || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new ValidationError(`Invalid ${field}.`);
  return value;
}
export function optionalString(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : string(value, field);
}
export function boolean(value: unknown, field: string): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') throw new ValidationError(`Invalid ${field}.`);
  return value as boolean | undefined;
}
export function choice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new ValidationError(`Invalid ${field}.`);
  return value as T;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ValidationError('Invalid sessionRevision.');
  return value as number;
}
export function identifier(value: unknown, field: string): string {
  const id = string(value, field, 1024);
  // Namespaces use '/', but components are identities, never filesystem paths.
  if (/[\\%]/.test(id) || id.split('/').some((part) => !part || part === '.' || part === '..')) throw new ValidationError(`Invalid ${field}.`);
  return id;
}
export function tool(value: unknown): string {
  const id = string(value, 'toolId', 128);
  if (!getToolById(id)) throw new ValidationError('Unknown toolId.');
  return id;
}
export function tools(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new ValidationError('Select between 1 and 20 tools.');
  const result = value.map(tool);
  if (new Set(result).size !== result.length) throw new ValidationError('Duplicate toolIds.');
  return result;
}
export async function assertRepoRoot(value: unknown, defaultRoot: string | null): Promise<string> {
  const input = value === undefined ? defaultRoot : string(value, 'repoRoot');
  if (!input || !path.isAbsolute(input)) throw new ValidationError('Select an existing absolute git repository root.');
  try {
    const canonical = await realpath(input);
    if (!(await stat(canonical)).isDirectory() || await findRepoRoot(canonical) !== canonical) throw new Error();
    return canonical;
  } catch { throw new ValidationError('Select an existing git repository root, not a subdirectory.'); }
}

export function bundleId(value: unknown): string {
  const id = string(value, 'bundleId', 64);
  if (!/^[a-f0-9]{64}$/.test(id)) throw new ValidationError('Invalid bundleId.');
  return id;
}
