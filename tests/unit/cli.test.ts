import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_DESCRIPTION, APP_VERSION } from '../../src/app-info.js';
import { BANNER, HELP_TEXT, parseCli } from '../../src/cli.js';

describe('BANNER', () => {
  it('includes the current app version in the startup logo', () => {
    expect(BANNER).toContain(`v${APP_VERSION}`);
  });
});

describe('parseCli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockExit() {
    return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
  }

  it('returns defaults when no arguments are given', () => {
    const result = parseCli([]);
    expect(result.source).toBeUndefined();
    expect(result.forceUpdate).toBe(false);
    expect(result.configPath).toBeUndefined();
  });

  it('takes the first positional argument as the source', () => {
    expect(parseCli(['https://skills.example.com', 'extra']).source).toBe(
      'https://skills.example.com',
    );
  });

  it('parses --update and --no-update', () => {
    expect(parseCli(['src', '--update']).forceUpdate).toBe(true);
    expect(parseCli(['src', '--update', '--no-update']).forceUpdate).toBe(false);
  });

  it('parses --config and its -c short flag', () => {
    expect(parseCli(['src', '--config', 'ai-skills.yml']).configPath).toBe('ai-skills.yml');
    expect(parseCli(['src', '--config=ai-skills.yml']).configPath).toBe('ai-skills.yml');
    expect(parseCli(['src', '-c', 'other.yml']).configPath).toBe('other.yml');
  });

  it('treats --config without a value as unset', () => {
    expect(parseCli(['src', '--config']).configPath).toBeUndefined();
  });

  it('ignores unknown flags', () => {
    const result = parseCli(['--verbose', 'src', '--update']);
    expect(result.source).toBe('src');
    expect(result.forceUpdate).toBe(true);
  });

  it('prints the version and exits 0 on --version', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockExit();
    expect(() => parseCli(['--version'])).toThrow('exit 0');
    expect(log).toHaveBeenCalledWith(APP_VERSION);
  });

  it('prints the description and help text and exits 0 on --help', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockExit();
    expect(() => parseCli(['--help'])).toThrow('exit 0');
    const output = String(log.mock.calls[0]?.[0]);
    expect(output).toContain(APP_DESCRIPTION);
    expect(output).toContain(HELP_TEXT);
  });

  it('showHelp prints help without exiting', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = mockExit();
    parseCli(['src']).showHelp();
    expect(exit).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain(HELP_TEXT);
  });
});
