import path from "node:path";
import process from "node:process";

import type { AppConfig } from "./types.js";

const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_READ_LENGTH = 4000;
const DEFAULT_SEARCH_LIMIT = 8;
const DEFAULT_WATCH_STABILITY_MS = 1500;

function resolvePath(baseDir: string, value: string | undefined, fallback: string): string {
  if (!value) {
    return path.resolve(baseDir, fallback);
  }

  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveConfig(baseDir = process.cwd()): AppConfig {
  const rootDir = path.resolve(baseDir);
  const dataDir = resolvePath(rootDir, process.env.FERNFH_S2_DATA_DIR, "data");
  const ocrLanguages = (process.env.FERNFH_S2_OCR_LANGS ?? "eng+deu")
    .split("+")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    rootDir,
    dataDir,
    rawDir: path.join(dataDir, "raw"),
    coursesDir: path.join(dataDir, "courses"),
    indexDir: path.join(dataDir, "index"),
    tmpDir: path.join(dataDir, ".tmp"),
    ocrLanguages,
    chunkSize: parsePositiveInt(process.env.FERNFH_S2_CHUNK_SIZE, DEFAULT_CHUNK_SIZE),
    chunkOverlap: parsePositiveInt(process.env.FERNFH_S2_CHUNK_OVERLAP, DEFAULT_CHUNK_OVERLAP),
    defaultReadLength: parsePositiveInt(process.env.FERNFH_S2_READ_LENGTH, DEFAULT_READ_LENGTH),
    defaultSearchLimit: parsePositiveInt(process.env.FERNFH_S2_SEARCH_LIMIT, DEFAULT_SEARCH_LIMIT),
    watchStabilityMs: parsePositiveInt(
      process.env.FERNFH_S2_WATCH_STABILITY_MS,
      DEFAULT_WATCH_STABILITY_MS
    )
  };
}
