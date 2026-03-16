import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { resolveConfig } from "../src/config.js";
import { CourseStore } from "../src/course-store.js";
import { CourseImportService } from "../src/import-service.js";
import { CourseIndexStore } from "../src/index-store.js";
import type { ContentExtractionResult, ContentExtractor, ExtractorKind } from "../src/types.js";
import { extractTextFromTesseractTsv } from "../src/utils/ocr.js";
import { DownloadWatcherService } from "../src/watcher-service.js";

const execFile = promisify(execFileCallback);

class StubExtractor implements ContentExtractor {
  constructor(
    private readonly fixtures: Record<
      string,
      {
        text?: string;
        indexed?: boolean;
        extractor?: ExtractorKind;
        mimeType?: string;
        warnings?: string[];
      }
    >
  ) {}

  async extract(_: string, relativePath: string): Promise<ContentExtractionResult> {
    const fixture = this.fixtures[relativePath];
    if (!fixture) {
      return {
        indexed: false,
        extractor: "skipped",
        mimeType: "application/octet-stream",
        warnings: [`No fixture configured for ${relativePath}`]
      };
    }

    return {
      indexed: fixture.indexed ?? Boolean(fixture.text),
      extractor: fixture.extractor ?? "text",
      mimeType: fixture.mimeType ?? "text/plain",
      text: fixture.text,
      warnings: fixture.warnings ?? []
    };
  }
}

async function createZipFixture(
  rootDir: string,
  zipName: string,
  files: Record<string, string>
): Promise<string> {
  const sourceDir = path.join(rootDir, "fixture");
  await mkdir(sourceDir, { recursive: true });

  for (const [relativePath, contents] of Object.entries(files)) {
    const targetPath = path.join(sourceDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, contents, "utf8");
  }

  const zipPath = path.join(rootDir, zipName);
  await execFile("zip", ["-qr", zipPath, "."], { cwd: sourceDir });
  return zipPath;
}

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "fernfh-s2-"));
}

async function waitForCondition(
  callback: () => Promise<void>,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await callback();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

describe("fernfh-s2 services", () => {
  const createdDirectories: string[] = [];

  afterEach(async () => {
    while (createdDirectories.length > 0) {
      const directory = createdDirectories.pop();
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  test("imports a ZIP, stores extracted text, and searches indexed chunks", async () => {
    const workspace = await createWorkspace();
    createdDirectories.push(workspace);

    const zipPath = await createZipFixture(workspace, "DAT505 - LLMs in Practice.zip", {
      "module1/intro.html": "<html>placeholder</html>",
      "slides/week1.pdf": "pdf placeholder",
      "images/overview.png": "png placeholder",
      "ignored.bin": "binary placeholder"
    });

    const config = resolveConfig(workspace);
    const courseStore = new CourseStore(config);
    const indexStore = new CourseIndexStore(config);
    const importer = new CourseImportService(
      config,
      courseStore,
      indexStore,
      new StubExtractor({
        "module1/intro.html": {
          extractor: "html",
          mimeType: "text/html",
          text: "This module introduces LLM retrieval workflows and study strategies."
        },
        "slides/week1.pdf": {
          extractor: "pdf",
          mimeType: "application/pdf",
          text: "Retrieval augmented generation combines search, chunking, and grounding."
        },
        "images/overview.png": {
          extractor: "ocr",
          mimeType: "image/png",
          text: "Prompt design checklist for trustworthy answers."
        }
      })
    );

    const result = await importer.importCourseZip(zipPath);

    expect(result.status).toBe("imported");
    expect(result.course.courseId).toBe("dat505-llms-in-practice");
    expect(result.course.documentCount).toBe(4);
    expect(result.course.indexedDocumentCount).toBe(3);

    const document = await courseStore.readDocument(
      "dat505-llms-in-practice",
      "module1/intro.html"
    );
    expect(document?.text).toContain("LLM retrieval workflows");

    const hits = await indexStore.search(
      ["dat505-llms-in-practice"],
      "retrieval augmented generation",
      5
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.documentPath).toBe("slides/week1.pdf");
    expect(hits[0]?.snippet).toContain("Retrieval augmented generation");
  });

  test("treats the same ZIP as idempotent and updates the same course on new content", async () => {
    const workspace = await createWorkspace();
    createdDirectories.push(workspace);

    const zipPathV1 = await createZipFixture(workspace, "DAT505 - LLMs in Practice.zip", {
      "notes/summary.txt": "v1"
    });

    const config = resolveConfig(workspace);
    const courseStore = new CourseStore(config);
    const indexStore = new CourseIndexStore(config);
    const importer = new CourseImportService(
      config,
      courseStore,
      indexStore,
      new StubExtractor({
        "notes/summary.txt": {
          extractor: "text",
          mimeType: "text/plain",
          text: "Version one covers embeddings and basic prompts."
        }
      })
    );

    const firstImport = await importer.importCourseZip(zipPathV1);
    const secondImport = await importer.importCourseZip(zipPathV1);

    expect(firstImport.status).toBe("imported");
    expect(secondImport.status).toBe("already_imported");

    const updateRoot = await createWorkspace();
    createdDirectories.push(updateRoot);
    const zipPathV2 = await createZipFixture(updateRoot, "DAT505 - LLMs in Practice.zip", {
      "notes/summary.txt": "v2 with changed bytes"
    });

    const updatedImporter = new CourseImportService(
      config,
      courseStore,
      indexStore,
      new StubExtractor({
        "notes/summary.txt": {
          extractor: "text",
          mimeType: "text/plain",
          text: "Version two adds reranking and evaluation."
        }
      })
    );

    const updateResult = await updatedImporter.importCourseZip(zipPathV2);
    expect(updateResult.status).toBe("updated");

    const hits = await indexStore.search(["dat505-llms-in-practice"], "reranking", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toContain("Version two adds reranking");
  });

  test(
    "derives a human-friendly course identity from raw ZIPs without duplicating the archive",
    async () => {
      const workspace = await createWorkspace();
      createdDirectories.push(workspace);

      const config = resolveConfig(workspace);
      await mkdir(config.rawDir, { recursive: true });

      const zipPath = await createZipFixture(config.rawDir, "DAT505.S.256.ITMA_2026037_1320.zip", {
        "Lehrmittel/LLMs in Practice/LLMs in Practice.html": "<html>placeholder</html>",
        "Allgemeines/LV-Konzept DAT505 - LLMs in Practice: Prompt Engineering & Workflow Design.pdf":
          "pdf placeholder"
      });

      const courseStore = new CourseStore(config);
      const indexStore = new CourseIndexStore(config);
      const importer = new CourseImportService(
        config,
        courseStore,
        indexStore,
        new StubExtractor({
          "Lehrmittel/LLMs in Practice/LLMs in Practice.html": {
            extractor: "html",
            mimeType: "text/html",
            text: "This course covers workflow design for LLM-based systems."
          },
          "Allgemeines/LV-Konzept DAT505 - LLMs in Practice: Prompt Engineering & Workflow Design.pdf":
            {
              extractor: "pdf",
              mimeType: "application/pdf",
              text: "Course outline"
            }
        })
      );

      const result = await importer.importCourseZip(zipPath);
      const manifest = await courseStore.getCourseManifest("dat505-llms-in-practice");
      const rawZipFiles = (await readdir(config.rawDir))
        .filter((name) => name.endsWith(".zip"))
        .sort();

      expect(result.status).toBe("imported");
      expect(result.course.courseId).toBe("dat505-llms-in-practice");
      expect(result.course.title).toBe("DAT505 - LLMs in Practice");
      expect(manifest?.rawZipPath).toBe(zipPath);
      expect(rawZipFiles).toEqual(["DAT505.S.256.ITMA_2026037_1320.zip"]);
    }
  );

  test(
    "watches a download directory, imports existing ZIPs on startup scan, and returns inactive status on unwatch",
    async () => {
      const workspace = await createWorkspace();
      createdDirectories.push(workspace);

      const config = resolveConfig(workspace);
      const courseStore = new CourseStore(config);
      const indexStore = new CourseIndexStore(config);
      const importer = new CourseImportService(
        config,
        courseStore,
        indexStore,
        new StubExtractor({
          "module/info.txt": {
            extractor: "text",
            mimeType: "text/plain",
            text: "Watcher imported this course successfully."
          }
        })
      );

      const watcher = new DownloadWatcherService(config, importer);
      const downloadDir = path.join(workspace, "downloads");
      await mkdir(downloadDir, { recursive: true });

      const startupZipRoot = await createWorkspace();
      createdDirectories.push(startupZipRoot);
      const startupZipPath = await createZipFixture(startupZipRoot, "INF101 - Basics.zip", {
        "module/info.txt": "watch me"
      });
      await copyFile(startupZipPath, path.join(downloadDir, path.basename(startupZipPath)));

      const watchResult = await watcher.watch(downloadDir);
      expect(watchResult.importedDuringStartup).toBe(1);
      expect(watchResult.active).toBe(true);

      const zipSourceRoot = await createWorkspace();
      createdDirectories.push(zipSourceRoot);
      const zipPath = await createZipFixture(zipSourceRoot, "INF102 - Advanced Basics.zip", {
        "module/info.txt": "watch me again with different bytes"
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      await copyFile(zipPath, path.join(downloadDir, path.basename(zipPath)));

      await waitForCondition(
        async () => {
          const courses = await courseStore.listCourses();
          expect(courses).toHaveLength(2);
          expect(courses.map((course) => course.courseId).sort()).toEqual([
            "inf101-basics",
            "inf102-advanced-basics"
          ]);
        },
        { timeoutMs: 12000, intervalMs: 250 }
      );

      const stopResult = await watcher.unwatch();
      expect(stopResult.active).toBe(false);
      expect(stopResult.directory).toBe(null);
    },
    15000
  );

  test("diversifies search results across documents before returning duplicate chunks", async () => {
    const workspace = await createWorkspace();
    createdDirectories.push(workspace);

    const zipPath = await createZipFixture(workspace, "DAT505 - LLMs in Practice.zip", {
      "docs/primary.txt": "primary",
      "docs/secondary.txt": "secondary"
    });

    const config = {
      ...resolveConfig(workspace),
      chunkSize: 90,
      chunkOverlap: 10
    };
    const courseStore = new CourseStore(config);
    const indexStore = new CourseIndexStore(config);
    const importer = new CourseImportService(
      config,
      courseStore,
      indexStore,
      new StubExtractor({
        "docs/primary.txt": {
          extractor: "text",
          mimeType: "text/plain",
          text: `${"workflow design improves agent quality. ".repeat(12)}Primary appendix.`
        },
        "docs/secondary.txt": {
          extractor: "text",
          mimeType: "text/plain",
          text: "Secondary notes explain workflow design tradeoffs for reliable orchestration."
        }
      })
    );

    await importer.importCourseZip(zipPath);

    const hits = await indexStore.search(["dat505-llms-in-practice"], "workflow design", 3);

    expect(hits).toHaveLength(3);
    expect(new Set(hits.slice(0, 2).map((hit) => hit.documentPath)).size).toBe(2);
  });

  test("filters low-confidence OCR words from tesseract TSV output", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t12.0\t@noise",
      "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t18.0\tjunk",
      "5\t1\t1\t1\t2\t1\t0\t0\t10\t10\t96.0\tValid",
      "5\t1\t1\t1\t2\t2\t0\t0\t10\t10\t94.0\ttext",
      "5\t1\t1\t1\t3\t1\t0\t0\t10\t10\t92.0\tMore",
      "5\t1\t1\t1\t3\t2\t0\t0\t10\t10\t91.0\tsignal"
    ].join("\n");

    const result = extractTextFromTesseractTsv(tsv);

    expect(result.text).toBe("Valid text\nMore signal");
    expect(result.droppedWordCount).toBe(2);
    expect(result.acceptedWordCount).toBe(4);
  });
});
