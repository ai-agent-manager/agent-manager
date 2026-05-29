import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusMessage } from '../../../src/components/StatusMessage.js';

describe('StatusMessage', () => {
  it('renders the success icon and message', () => {
    const { lastFrame } = render(<StatusMessage type="success" message="All done" />);
    expect(lastFrame()).toContain('✔');
    expect(lastFrame()).toContain('All done');
  });

  it('renders the error icon and message', () => {
    const { lastFrame } = render(<StatusMessage type="error" message="Something went wrong" />);
    expect(lastFrame()).toContain('✘');
    expect(lastFrame()).toContain('Something went wrong');
  });

  it('renders the warning icon and message', () => {
    const { lastFrame } = render(<StatusMessage type="warning" message="Proceed with caution" />);
    expect(lastFrame()).toContain('⚠');
    expect(lastFrame()).toContain('Proceed with caution');
  });

  it('renders the info icon and message', () => {
    const { lastFrame } = render(<StatusMessage type="info" message="Here is some info" />);
    expect(lastFrame()).toContain('ℹ');
    expect(lastFrame()).toContain('Here is some info');
  });
});
