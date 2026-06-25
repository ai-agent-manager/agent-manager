import chalk from 'chalk';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export interface ConsoleSpinner {
  update(message: string): void;
  stop(): void;
}

function buildLine(frame: string, message: string): string {
  return `  ${chalk.cyan(frame)} ${message}`;
}

export function startConsoleSpinner(initialMessage: string): ConsoleSpinner {
  if (!process.stdout.isTTY) {
    console.log(`  ${initialMessage}`);
    return { update: () => undefined, stop: () => undefined };
  }

  let message = initialMessage;
  let frameIndex = 0;
  let lastLineLength = 0;
  let stopped = false;

  function writeLine(): void {
    const line = buildLine(FRAMES[frameIndex], message);
    const padding = ' '.repeat(Math.max(0, lastLineLength - line.length));
    process.stdout.write(`\r${line}${padding}`);
    lastLineLength = line.length;
    frameIndex = (frameIndex + 1) % FRAMES.length;
  }

  writeLine();
  const timer = setInterval(writeLine, INTERVAL_MS);

  return {
    update(newMessage: string): void {
      if (stopped) return;
      message = newMessage;
      writeLine();
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      const clear = ' '.repeat(lastLineLength);
      process.stdout.write(`\r${clear}\r`);
    },
  };
}
