import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/app-info.js';
import { BANNER } from '../../src/cli.js';

describe('BANNER', () => {
  it('includes the current app version in the startup logo', () => {
    expect(BANNER).toContain(`v${APP_VERSION}`);
  });
});
