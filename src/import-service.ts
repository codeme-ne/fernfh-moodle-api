import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AppConfig,
  ChunkDocument,
  ContentExtractor,
  CourseManifest,
  ImportCourseResult,
  Logger
} from "./types.js";
import { CourseStore } from "./course-store.js";
import { CourseIndexStore } from "./index-store.js";
import {
  ensureDir,
  hashFileSha256,
  listFilesRecursive,
  normalizeRelativePath,
  pathExists,
  replaceDirectory,
  replaceFile,
  safeResolve,
  slugify,
  writeJson
} from "./utils/fs.js";
import { runCommand } from "./utils/exec.js";
import { chunkText, normalizeWhitespace } from "./utils/text.js";

interface ImportedFileEntry {
  filePath: string;
  relativePath: string;
}

interface DetectedCourseIdentity {
  courseCode: string | null;
  title: string;
}

const COURSE_CODE_PATTERN = /\b[A-Z]{3}\d{3}\b/u;
const CONCEPT_FILE_PATTERN = /^LV[- ]?Konzept\b/iu;
const GENERIC_DIRECTORY_NAMES = new Set([
  "allgemeines",
  "data",
  "downloads",
  "empfohlene literatur",
  "erganzende unterlagen",
  "intro",
  "lehrmittel",
  "lessions learned",
  "materialen",
  "materialien",
  "source",
  "wissensuberprufung",
  "zusatzliche unterlagen"
]);

export class CourseImportService {
  constructor(
    private readonly config: AppConfig,
    private readonly courseStore: CourseStore,
    private readonly indexStore: CourseIndexStore,
    private readonly extractor: ContentExtractor,
    private readonly logger?: Logger
  ) {}

  async importCourseZip(inputPath: string): Promise<ImportCourseResult> {
    await this.courseStore.initialize();

    const resolvedZipPath = path.resolve(this.config.rootDir, inputPath);
    if (!(await pathExists(resolvedZipPath))) {
      throw new Error(`ZIP file not found: ${resolvedZipPath}`);
    }

    if (path.extname(resolvedZipPath).toLowerCase() !== ".zip") {
      throw new Error(`Only ZIP files can be imported: ${resolvedZipPath}`);
    }

    const sourceHash = await hashFileSha256(resolvedZipPath);
    const existingByHash = await this.courseStore.findBySourceHash(sourceHash);
    const existingByHashManifest = existingByHash
      ? await this.courseStore.getCourseManifest(existingByHash.courseId)
      : null;
    const sourceZipName = path.basename(resolvedZipPath);
    const tempRoot = await mkdtemp(path.join(this.config.tmpDir, "course-import-"));

    try {
      const stagedCourseDir = path.join(tempRoot, "course");
      const stagedSourceDir = path.join(stagedCourseDir, "source");
      const stagedTextDir = path.join(stagedCourseDir, "text");

      await ensureDir(stagedSourceDir);
      await ensureDir(stagedTextDir);
      await this.extractZipArchive(resolvedZipPath, stagedSourceDir);

      const fileEntries = (await listFilesRecursive(stagedSourceDir))
        .sort()
        .map((filePath) => ({
          filePath,
          relativePath: normalizeRelativePath(stagedSourceDir, filePath)
        }));

      const identity = await this.detectCourseIdentity(fileEntries, sourceZipName);
      const courseId = slugify(identity.title);
      const stagedIndexPath = path.join(tempRoot, `${courseId}.json`);

      if (
        existingByHash &&
        existingByHash.courseId === courseId &&
        existingByHash.title === identity.title
      ) {
        return {
          status: "already_imported",
          course: existingByHash,
          warnings: []
        };
      }

      const existingCourse = await this.courseStore.getCourseManifest(courseId);
      const migratedCourseId =
        existingByHash && existingByHash.courseId !== courseId ? existingByHash.courseId : null;
      const importStatus = existingCourse || existingByHash ? "updated" : "imported";
      const rawZipPath = this.resolveRawZipPath(
        resolvedZipPath,
        courseId,
        sourceHash,
        sourceZipName
      );

      const documents = [];
      const chunks: ChunkDocument[] = [];
      const warnings: string[] = [];

      for (const entry of fileEntries) {
        const extraction = await this.extractor.extract(entry.filePath, entry.relativePath);
        const resourceUri = this.courseStore.createResourceUri(courseId, entry.relativePath);
        const documentWarnings = [...extraction.warnings];

        let textRelativePath: string | null = null;
        let charCount = 0;
        let chunkCount = 0;
        let indexed = false;

        if (extraction.indexed && extraction.text) {
          textRelativePath = `${entry.relativePath}.txt`;
          const stagedTextPath = safeResolve(stagedTextDir, textRelativePath);
          await ensureDir(path.dirname(stagedTextPath));
          await writeFile(stagedTextPath, extraction.text, "utf8");

          const textChunks = chunkText(
            extraction.text,
            this.config.chunkSize,
            this.config.chunkOverlap
          );

          charCount = extraction.text.length;
          chunkCount = textChunks.length;
          indexed = textChunks.length > 0;

          if (!indexed) {
            documentWarnings.push("Extracted text was empty after normalization.");
          }

          for (const chunk of textChunks) {
            chunks.push({
              id: `${courseId}:${entry.relativePath}#${chunk.index}`,
              courseId,
              courseTitle: identity.title,
              documentPath: entry.relativePath,
              documentTitle: path.basename(entry.relativePath),
              mimeType: extraction.mimeType,
              chunkIndex: chunk.index,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
              text: chunk.text,
              resourceUri
            });
          }
        }

        documents.push({
          relativePath: entry.relativePath,
          textRelativePath,
          mimeType: extraction.mimeType,
          extractor: extraction.extractor,
          indexed,
          charCount,
          chunkCount,
          warnings: documentWarnings,
          resourceUri
        });

        for (const warning of documentWarnings) {
          warnings.push(`${entry.relativePath}: ${warning}`);
        }
      }

      await ensureDir(path.dirname(rawZipPath));
      if (rawZipPath !== resolvedZipPath && !(await pathExists(rawZipPath))) {
        await copyFile(resolvedZipPath, rawZipPath);
      }

      const now = new Date().toISOString();
      const manifest: CourseManifest = {
        courseId,
        title: identity.title,
        sourceZipName,
        sourceHash,
        sourceZipOriginalPath: resolvedZipPath,
        rawZipPath,
        importedAt: existingCourse?.importedAt ?? existingByHashManifest?.importedAt ?? now,
        updatedAt: now,
        documentCount: documents.length,
        indexedDocumentCount: documents.filter((document) => document.indexed).length,
        chunkCount: chunks.length,
        documents
      };

      await writeJson(path.join(stagedCourseDir, "course.json"), manifest);
      await writeJson(stagedIndexPath, this.indexStore.buildIndexPayload(courseId, chunks));
      await replaceDirectory(this.courseStore.getCourseDir(courseId), stagedCourseDir);
      await replaceFile(this.courseStore.getIndexPath(courseId), stagedIndexPath);

      if (migratedCourseId) {
        await this.courseStore.removeCourse(migratedCourseId);
      }

      const obsoleteRawZipPath = existingByHashManifest?.rawZipPath;
      if (
        obsoleteRawZipPath &&
        obsoleteRawZipPath !== rawZipPath &&
        obsoleteRawZipPath !== resolvedZipPath &&
        isInsideDirectory(obsoleteRawZipPath, this.config.rawDir)
      ) {
        await rm(obsoleteRawZipPath, { force: true });
      }

      await this.courseStore.upsertCourse(manifest);

      await this.logger?.info(
        `${importStatus === "updated" ? "Updated" : "Imported"} ${courseId} (${documents.length} files, ${chunks.length} chunks).`
      );

      return {
        status: importStatus,
        course: this.courseStore.toRegistryEntry(manifest),
        warnings
      };
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  private async extractZipArchive(zipPath: string, targetDir: string): Promise<void> {
    try {
      await runCommand("7z", ["x", "-y", `-o${targetDir}`, zipPath]);
      return;
    } catch {
      await runCommand("unzip", ["-qq", zipPath, "-d", targetDir]);
    }
  }

  private async detectCourseIdentity(
    fileEntries: ImportedFileEntry[],
    sourceZipName: string
  ): Promise<DetectedCourseIdentity> {
    const fallbackStem = path.basename(sourceZipName, path.extname(sourceZipName)).trim();
    const fallbackIdentity = parseFallbackStem(fallbackStem);
    const conceptEntry = fileEntries.find((entry) =>
      CONCEPT_FILE_PATTERN.test(path.basename(entry.relativePath, path.extname(entry.relativePath)))
    );

    const titleFromFolder = detectFolderTitle(fileEntries);
    let courseCode = fallbackIdentity.courseCode;
    let detailedTitle: string | null = null;

    if (conceptEntry) {
      const fileNameIdentity = parseConceptFilename(
        path.basename(conceptEntry.relativePath, path.extname(conceptEntry.relativePath))
      );

      courseCode = fileNameIdentity.courseCode ?? courseCode;
      detailedTitle = fileNameIdentity.title;

      if (path.extname(conceptEntry.filePath).toLowerCase() === ".pdf") {
        const metadata = await this.readCourseMetadataFromConceptPdf(conceptEntry.filePath);
        courseCode = metadata.courseCode ?? courseCode;
        detailedTitle = metadata.title ?? detailedTitle;
      }
    }

    const preferredTitle = titleFromFolder ?? shortenTitle(detailedTitle) ?? fallbackIdentity.title ?? null;
    const title = buildCourseTitle(courseCode, preferredTitle, fallbackStem);

    return {
      courseCode,
      title
    };
  }

  private async readCourseMetadataFromConceptPdf(
    filePath: string
  ): Promise<{ courseCode: string | null; title: string | null }> {
    try {
      const { stdout } = await runCommand("pdftotext", [filePath, "-"]);
      return parseCourseMetadata(stdout);
    } catch {
      return {
        courseCode: null,
        title: null
      };
    }
  }

  private resolveRawZipPath(
    resolvedZipPath: string,
    courseId: string,
    sourceHash: string,
    sourceZipName: string
  ): string {
    if (isInsideDirectory(resolvedZipPath, this.config.rawDir)) {
      return resolvedZipPath;
    }

    return this.courseStore.getRawZipPath(courseId, sourceHash, sourceZipName);
  }
}

function parseCourseMetadata(text: string): { courseCode: string | null; title: string | null } {
  const lines = text.split(/\r?\n/u).map((line) => normalizeHumanTitle(line));
  const title = findLabeledValue(lines, /^Titel\s*:?\s*(.*)$/iu);
  const courseCode = extractCourseCode(findLabeledValue(lines, /^LVNr\.?\s*:?\s*(.*)$/iu) ?? text);

  return {
    courseCode,
    title
  };
}

function findLabeledValue(lines: string[], pattern: RegExp): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    const inlineValue = normalizeHumanTitle(match[1] ?? "");
    if (inlineValue) {
      return inlineValue;
    }

    for (let nextIndex = index + 1; nextIndex < Math.min(lines.length, index + 5); nextIndex += 1) {
      const candidate = lines[nextIndex] ?? "";
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function parseConceptFilename(fileStem: string): { courseCode: string | null; title: string | null } {
  const cleanedStem = normalizeHumanTitle(
    fileStem.replace(CONCEPT_FILE_PATTERN, "").replace(/^[\s._-]+/u, "")
  );
  const match = cleanedStem.match(/^([A-Z]{3}\d{3})\s*-\s*(.+)$/u);

  if (match) {
    return {
      courseCode: match[1] ?? null,
      title: normalizeHumanTitle(match[2] ?? "")
    };
  }

  return {
    courseCode: extractCourseCode(cleanedStem),
    title: cleanedStem || null
  };
}

function parseFallbackStem(stem: string): { courseCode: string | null; title: string | null } {
  const cleanedStem = normalizeHumanTitle(stem.replace(/[._]+/g, " "));
  const match = cleanedStem.match(/^([A-Z]{3}\d{3})\s*-\s*(.+)$/u);

  if (match) {
    return {
      courseCode: match[1] ?? null,
      title: normalizeHumanTitle(match[2] ?? "")
    };
  }

  return {
    courseCode: extractCourseCode(cleanedStem),
    title: null
  };
}

function detectFolderTitle(fileEntries: ImportedFileEntry[]): string | null {
  const scoredCandidates = new Map<string, number>();

  for (const entry of fileEntries) {
    const segments = entry.relativePath.split("/");
    if (segments.length < 2) {
      continue;
    }

    const parentDirectory = segments[segments.length - 2] ?? "";
    const fileStem = path.posix.basename(entry.relativePath, path.posix.extname(entry.relativePath));

    if (!parentDirectory || isGenericDirectoryName(parentDirectory)) {
      continue;
    }

    if (normalizeComparable(parentDirectory) !== normalizeComparable(fileStem)) {
      continue;
    }

    const weight = segments.includes("Lehrmittel") ? 3 : 1;
    const currentScore = scoredCandidates.get(parentDirectory) ?? 0;
    scoredCandidates.set(parentDirectory, currentScore + weight);
  }

  const bestCandidate = [...scoredCandidates.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return bestCandidate ? normalizeHumanTitle(bestCandidate) : null;
}

function buildCourseTitle(
  courseCode: string | null,
  detectedTitle: string | null,
  fallbackStem: string
): string {
  if (courseCode && detectedTitle) {
    if (normalizeComparable(detectedTitle).startsWith(normalizeComparable(courseCode))) {
      return detectedTitle;
    }

    return `${courseCode} - ${detectedTitle}`;
  }

  if (detectedTitle) {
    return detectedTitle;
  }

  if (courseCode) {
    return courseCode;
  }

  return normalizeHumanTitle(fallbackStem);
}

function shortenTitle(title: string | null): string | null {
  if (!title) {
    return null;
  }

  const normalizedTitle = normalizeHumanTitle(title);
  const [head] = normalizedTitle.split(/\s*:\s*/u);
  const shortened = normalizeHumanTitle(head ?? normalizedTitle);

  return shortened || normalizedTitle || null;
}

function extractCourseCode(value: string): string | null {
  const match = value.match(COURSE_CODE_PATTERN);
  return match?.[0] ?? null;
}

function normalizeHumanTitle(value: string): string {
  return normalizeWhitespace(value.replace(/_{2,}/gu, " "));
}

function normalizeComparable(value: string): string {
  return normalizeHumanTitle(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function isGenericDirectoryName(value: string): boolean {
  return GENERIC_DIRECTORY_NAMES.has(
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(directoryPath, filePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
