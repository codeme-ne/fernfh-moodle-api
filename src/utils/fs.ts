import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export async function ensureDir(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  if (!(await pathExists(filePath))) {
    return fallback;
  }

  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));

  const tempPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function listFilesRecursive(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(entryPath);
      }

      return entry.isFile() ? [entryPath] : [];
    })
  );

  return files.flat();
}

export async function hashFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => resolve());
    stream.on("error", (error) => reject(error));
  });

  return hash.digest("hex");
}

export function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || "course";
}

export function normalizeRelativePath(rootPath: string, filePath: string): string {
  const relativePath = path.relative(rootPath, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path "${filePath}" is outside of "${rootPath}".`);
  }

  return relativePath.split(path.sep).join(path.posix.sep);
}

export function safeResolve(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path traversal detected for "${relativePath}".`);
  }

  return resolved;
}

export async function replaceDirectory(targetPath: string, sourcePath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
  await ensureDir(path.dirname(targetPath));
  await rename(sourcePath, targetPath);
}

export async function replaceFile(targetPath: string, sourcePath: string): Promise<void> {
  await rm(targetPath, { force: true });
  await ensureDir(path.dirname(targetPath));
  await rename(sourcePath, targetPath);
}
