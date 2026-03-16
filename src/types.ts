export interface AppConfig {
  rootDir: string;
  dataDir: string;
  rawDir: string;
  coursesDir: string;
  indexDir: string;
  tmpDir: string;
  ocrLanguages: string[];
  chunkSize: number;
  chunkOverlap: number;
  defaultReadLength: number;
  defaultSearchLimit: number;
  watchStabilityMs: number;
}

export type ExtractorKind = "pdf" | "html" | "ocr" | "text" | "skipped";

export interface ContentExtractionResult {
  indexed: boolean;
  extractor: ExtractorKind;
  mimeType: string;
  text?: string;
  warnings: string[];
}

export interface DocumentRecord {
  relativePath: string;
  textRelativePath: string | null;
  mimeType: string;
  extractor: ExtractorKind;
  indexed: boolean;
  charCount: number;
  chunkCount: number;
  warnings: string[];
  resourceUri: string;
}

export interface CourseRegistryEntry {
  courseId: string;
  title: string;
  sourceZipName: string;
  sourceHash: string;
  importedAt: string;
  updatedAt: string;
  documentCount: number;
  indexedDocumentCount: number;
  chunkCount: number;
}

export interface CourseManifest extends CourseRegistryEntry {
  sourceZipOriginalPath: string;
  rawZipPath: string;
  documents: DocumentRecord[];
}

export interface ChunkDocument {
  id: string;
  courseId: string;
  courseTitle: string;
  documentPath: string;
  documentTitle: string;
  mimeType: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
  resourceUri: string;
}

export interface SearchHit {
  courseId: string;
  courseTitle: string;
  documentPath: string;
  documentTitle: string;
  mimeType: string;
  chunkIndex: number;
  score: number;
  snippet: string;
  resourceUri: string;
}

export interface StoredCourseIndex {
  version: 1;
  courseId: string;
  indexedAt: string;
  chunks: number;
  payload: unknown;
}

export interface ImportCourseResult {
  status: "imported" | "updated" | "already_imported";
  course: CourseRegistryEntry;
  warnings: string[];
}

export interface ReadDocumentResult {
  courseId: string;
  documentPath: string;
  mimeType: string;
  totalLength: number;
  offset: number;
  length: number;
  text: string;
  resourceUri: string;
}

export interface WatchStatus {
  active: boolean;
  directory: string | null;
  startedAt: string | null;
  importedCount: number;
  lastImportedAt: string | null;
  lastError: string | null;
}

export interface WatchStartResult extends WatchStatus {
  importedDuringStartup: number;
}

export interface Logger {
  info(message: string): Promise<void> | void;
  error(message: string): Promise<void> | void;
}

export interface ContentExtractor {
  extract(filePath: string, relativePath: string): Promise<ContentExtractionResult>;
}
