import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { AppConfig, CourseManifest, CourseRegistryEntry, DocumentRecord } from "./types.js";
import { ensureDir, pathExists, readJson, safeResolve, slugify, writeJson } from "./utils/fs.js";

interface CourseRegistryFile {
  version: 1;
  courses: CourseRegistryEntry[];
}

const EMPTY_REGISTRY: CourseRegistryFile = {
  version: 1,
  courses: []
};

export class CourseStore {
  constructor(private readonly config: AppConfig) {}

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDir(this.config.dataDir),
      ensureDir(this.config.rawDir),
      ensureDir(this.config.coursesDir),
      ensureDir(this.config.indexDir),
      ensureDir(this.config.tmpDir)
    ]);

    if (!(await pathExists(this.getRegistryPath()))) {
      await writeJson(this.getRegistryPath(), EMPTY_REGISTRY);
    }
  }

  getRegistryPath(): string {
    return path.join(this.config.indexDir, "courses.json");
  }

  getCourseDir(courseId: string): string {
    return path.join(this.config.coursesDir, courseId);
  }

  getSourceDir(courseId: string): string {
    return path.join(this.getCourseDir(courseId), "source");
  }

  getTextDir(courseId: string): string {
    return path.join(this.getCourseDir(courseId), "text");
  }

  getManifestPath(courseId: string): string {
    return path.join(this.getCourseDir(courseId), "course.json");
  }

  getIndexPath(courseId: string): string {
    return path.join(this.config.indexDir, `${courseId}.json`);
  }

  getRawZipPath(courseId: string, sourceHash: string, sourceZipName: string): string {
    const extension = path.extname(sourceZipName) || ".zip";
    const baseName = slugify(path.basename(sourceZipName, extension));
    return path.join(this.config.rawDir, `${baseName || courseId}-${sourceHash.slice(0, 8)}${extension}`);
  }

  createResourceUri(courseId: string, documentPath: string): string {
    return `course://documents/${encodeURIComponent(courseId)}/${encodeURIComponent(documentPath)}`;
  }

  parseResourceUri(resourceUri: string): { courseId: string; documentPath: string } {
    const parsed = new URL(resourceUri);
    if (parsed.protocol !== "course:" || parsed.hostname !== "documents") {
      throw new Error(`Unsupported resource URI: ${resourceUri}`);
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 2) {
      throw new Error(`Invalid resource URI: ${resourceUri}`);
    }

    return {
      courseId: decodeURIComponent(segments[0] ?? ""),
      documentPath: decodeURIComponent(segments[1] ?? "")
    };
  }

  toRegistryEntry(manifest: CourseManifest): CourseRegistryEntry {
    return {
      courseId: manifest.courseId,
      title: manifest.title,
      sourceZipName: manifest.sourceZipName,
      sourceHash: manifest.sourceHash,
      importedAt: manifest.importedAt,
      updatedAt: manifest.updatedAt,
      documentCount: manifest.documentCount,
      indexedDocumentCount: manifest.indexedDocumentCount,
      chunkCount: manifest.chunkCount
    };
  }

  async listCourses(): Promise<CourseRegistryEntry[]> {
    const registry = await this.readRegistry();
    return [...registry.courses].sort((left, right) => left.title.localeCompare(right.title));
  }

  async listCourseManifests(): Promise<CourseManifest[]> {
    const courses = await this.listCourses();
    const manifests = await Promise.all(courses.map((course) => this.getCourseManifest(course.courseId)));
    return manifests.filter((manifest): manifest is CourseManifest => manifest !== null);
  }

  async getCourseManifest(courseId: string): Promise<CourseManifest | null> {
    const manifestPath = this.getManifestPath(courseId);
    if (!(await pathExists(manifestPath))) {
      return null;
    }

    return readJson<CourseManifest | null>(manifestPath, null);
  }

  async findBySourceHash(sourceHash: string): Promise<CourseRegistryEntry | null> {
    const courses = await this.listCourses();
    return courses.find((course) => course.sourceHash === sourceHash) ?? null;
  }

  async upsertCourse(manifest: CourseManifest): Promise<void> {
    const registry = await this.readRegistry();
    const updatedCourses = registry.courses.filter((course) => course.courseId !== manifest.courseId);
    updatedCourses.push(this.toRegistryEntry(manifest));

    await writeJson(this.getRegistryPath(), {
      version: 1,
      courses: updatedCourses.sort((left, right) => left.title.localeCompare(right.title))
    } satisfies CourseRegistryFile);
  }

  async removeCourse(courseId: string): Promise<void> {
    const registry = await this.readRegistry();
    await rm(this.getCourseDir(courseId), { recursive: true, force: true });
    await rm(this.getIndexPath(courseId), { force: true });

    await writeJson(this.getRegistryPath(), {
      version: 1,
      courses: registry.courses.filter((course) => course.courseId !== courseId)
    } satisfies CourseRegistryFile);
  }

  async readDocument(
    courseId: string,
    documentPath: string
  ): Promise<{ manifest: CourseManifest; document: DocumentRecord; text: string } | null> {
    const manifest = await this.getCourseManifest(courseId);
    if (!manifest) {
      return null;
    }

    const document = manifest.documents.find((entry) => entry.relativePath === documentPath);
    if (!document?.textRelativePath) {
      return null;
    }

    const textPath = safeResolve(this.getTextDir(courseId), document.textRelativePath);
    const text = await readFile(textPath, "utf8");

    return {
      manifest,
      document,
      text
    };
  }

  private async readRegistry(): Promise<CourseRegistryFile> {
    return readJson<CourseRegistryFile>(this.getRegistryPath(), EMPTY_REGISTRY);
  }
}
