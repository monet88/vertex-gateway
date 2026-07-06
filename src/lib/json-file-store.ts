import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const readJsonIfExists = <T>(filePath: string): T | null => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
};

const openUniqueTempFile = (filePath: string): { fd: number; tempPath: string } => {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = `${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}`;
    const tempPath = path.join(directory, `.${baseName}.${suffix}.tmp`);

    try {
      const fd = fs.openSync(
        tempPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600,
      );
      return { fd, tempPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
  }

  throw new Error(`Failed to allocate a temporary path for ${filePath}.`);
};

const fsyncDirectoryBestEffort = (directory: string): void => {
  let fd = -1;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } catch {
    // Directory fsync is not supported on every platform/filesystem.
  } finally {
    if (fd !== -1) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close failures for best-effort directory durability.
      }
    }
  }
};

export const writeJsonAtomic = (filePath: string, value: unknown): void => {
  const data = JSON.stringify(value, null, 2);
  let fd = -1;
  let tempPath = '';

  try {
    const opened = openUniqueTempFile(filePath);
    fd = opened.fd;
    tempPath = opened.tempPath;

    fs.writeFileSync(fd, data, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = -1;

    fs.renameSync(tempPath, filePath);
    fsyncDirectoryBestEffort(path.dirname(filePath));
  } catch (error) {
    if (fd !== -1) {
      try {
        fs.closeSync(fd);
      } catch {
        // Preserve the original write/flush/rename failure.
      }
    }
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup; the original error is more useful.
      }
    }
    throw error;
  }
};
