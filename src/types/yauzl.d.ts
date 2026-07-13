declare module 'yauzl' {
  import { EventEmitter } from 'node:events';

  interface OpenOptions {
    autoClose?: boolean;
    lazyEntries?: boolean;
    decodeStrings?: boolean;
    validateEntrySizes?: boolean;
  }

  interface Entry {
    fileName: string;
    uncompressedSize: number;
    compressedSize: number;
    compressionMethod: number;
  }

  class ZipFile extends EventEmitter {
    readEntry(): void;
    close(): void;
    on(event: 'entry', listener: (entry: Entry) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  function open(
    path: string,
    options: OpenOptions,
    callback: (err: Error | null, zipfile: ZipFile) => void,
  ): void;
}
