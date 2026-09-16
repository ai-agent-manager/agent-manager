import { describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../../src/app-info.js';
import { BANNER, parseCli } from '../../src/cli.js';

describe('BANNER', () => {
  it('includes the current app version in the startup logo', () => {
    expect(BANNER).toContain(`v${APP_VERSION}`);
  });
});

describe('parseCli', () => {
  it('keeps TUI and headless invocation compatible', () => {
    expect(parseCli(['https://skills.example.com', '--update', '--config', 'skills.yml'])).toMatchObject({ command: 'tui', source: 'https://skills.example.com', forceUpdate: true, configPath: 'skills.yml' });
    expect(parseCli([])).toMatchObject({ command: 'tui', source: undefined });
  });
  it('parses the UI source, ephemeral port, browser preference and update flag', () => {
    expect(parseCli(['ui', './bundle', '--port=0', '--no-open', '--update'])).toMatchObject({ command: 'ui', source: './bundle', port: 0, portExplicit: true, open: false, forceUpdate: true });
    expect(parseCli(['ui'])).toMatchObject({ command: 'ui', port: 19877, portExplicit: false, open: true });
  });
  it.each([['ui', '--config', 'skills.yml'], ['ui', 'one', 'two'], ['ui', '--port=-1'], ['ui', '--port=65536'], ['ui', '--port=1.5'], ['--no-open'], ['--port=0']])('rejects incompatible/invalid arguments: %s', (...args) => {
    expect(() => parseCli(args)).toThrow();
  });
});

it('explicit help takes priority over UI dispatch and incompatible flags', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('help exit'); });
  try {
    expect(() => parseCli(['ui', '--help', '--config', 'skills.yml'])).toThrow('help exit');
    expect(exit).toHaveBeenCalledWith(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage'));
  } finally { exit.mockRestore(); log.mockRestore(); }
});
