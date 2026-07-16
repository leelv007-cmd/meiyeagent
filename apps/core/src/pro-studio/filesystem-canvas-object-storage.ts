import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { CanvasObjectStorage } from './canvas-asset-facade.js';

export class FileSystemCanvasObjectStorage implements CanvasObjectStorage {
  private readonly root: string;

  constructor(rootDirectory: string) {
    this.root = resolve(rootDirectory);
  }

  async put(objectKey: string, bytes: Uint8Array) {
    const target = this.pathFor(objectKey);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  }

  async read(objectKey: string) {
    try {
      return Uint8Array.from(await readFile(this.pathFor(objectKey)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private pathFor(objectKey: string) {
    if (
      !objectKey ||
      objectKey.startsWith('/') ||
      objectKey.includes('..') ||
      objectKey.includes('\\')
    ) {
      throw new Error('Invalid canvas asset object key.');
    }
    const target = resolve(this.root, objectKey);
    if (!target.startsWith(`${this.root}${sep}`)) {
      throw new Error('Canvas asset object key escaped the storage root.');
    }
    return target;
  }
}
