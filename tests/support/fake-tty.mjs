// Preload (`node --import`) that makes piped stdio look like an interactive terminal, so
// Ink renders its live frames and accepts raw-mode input where no pty is available
// (Windows has no `script`). Ink only checks `isTTY === true` and a `setRawMode` function.
for (const stream of [process.stdout, process.stderr]) {
  Object.assign(stream, { isTTY: true, columns: 120, rows: 40 });
  stream.getColorDepth ??= () => 8;
  stream.hasColors ??= () => true;
}
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;
