// Vendored from ink-spinner@5.0.0 (MIT, Copyright (c) Vadym Demedes), limited
// to the "dots" frames from cli-spinners (MIT, Copyright (c) Sindre Sorhus).
// Kept in-tree so every React consumer resolves the CLI's own react/ink copy;
// see src/components/ink/README.md.
import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const DOTS = {
  interval: 80,
  frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

export default function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((previousFrame) => (previousFrame === DOTS.frames.length - 1 ? 0 : previousFrame + 1));
    }, DOTS.interval);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return <Text>{DOTS.frames[frame]}</Text>;
}
