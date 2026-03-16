---
title: Code Review Findings — Security, Performance, Tests, Cleanup
type: refactor
status: active
date: 2026-03-07
---

# Code Review Findings — Security, Performance, Tests, Cleanup

## Overview

Implement all findings from the multi-agent code review in priority order: critical security fixes first, then the highest-impact performance improvement, then unit tests, then dead code removal.

## Phase 1: Critical Security Fixes (P1)

### 1.1 Sanitize `courseId` in path construction

**Problem:** MCP tool inputs pass `courseId` directly to `path.join(coursesDir, courseId)`. A value like `../../etc` escapes the data directory. Affects `getCourseDir`, `getIndexPath`, `getSourceDir`, `getTextDir`, `getManifestPath` in `course-store.ts` and `loadIndex` in `index-store.ts`.

**Solution:** Add a `validateCourseId` guard that rejects any `courseId` not matching `/^[a-z0-9-]+$/`. Call it at the top of every public method that accepts a `courseId` from external input. Also apply it in `index-store.ts:loadIndex`.

**Files:**
- [ ] `src/course-store.ts` — add `validateCourseId` private method, call in `getCourseManifest`, `readDocument`, `removeCourse`, `findBySourceHash` (indirect via listCourses is safe)
- [ ] `src/index-store.ts` — validate `courseId` in `loadIndex` before constructing path
- [ ] `src/server.ts` — validate `courseId` at tool input level in `search_course` and `read_document` handlers (defense in depth)

### 1.2 Post-extraction ZIP Slip check

**Problem:** `7z x` does not protect against `../` path components. Files are written to disk *before* `normalizeRelativePath` validates them.

**Solution:** After `extractZipArchive` returns, before processing files, verify every extracted path resolves within `stagedSourceDir`. Use `listFilesRecursive` result (already collected at line 95) and check each path with a relative-path-within-root assertion. If any file is outside, throw and clean up. This catches the attack after extraction but before any content processing or indexing.

**Files:**
- [ ] `src/import-service.ts` — add validation loop after `listFilesRecursive` call (~line 100), before the processing loop. Verify `path.relative(stagedSourceDir, filePath)` does not start with `..` and is not absolute for each entry.

### 1.3 Runtime JSON validation with Zod at deserialization boundary

**Problem:** `readJson<T>` performs `JSON.parse(raw) as T` — no runtime validation. Corrupted files silently produce malformed objects.

**Solution:** Add an optional `schema` parameter to `readJson`. When provided, parse with `schema.parse()`. Create Zod schemas for `CourseRegistryFile`, `CourseManifest`, and `StoredCourseIndex` (the three shapes read from disk). Use them at all call sites.

**Files:**
- [ ] `src/utils/fs.ts` — extend `readJson` signature: `readJson<T>(filePath: string, fallback: T, schema?: z.ZodType<T>): Promise<T>`. When `schema` is provided, validate after `JSON.parse`.
- [ ] `src/schemas.ts` (new) — Zod schemas for `CourseRegistryFile`, `CourseManifest`, `StoredCourseIndex`. Reuse `courseSummarySchema`/`searchHitSchema` from `server.ts` where possible, or define shared schemas here and import in `server.ts`.
- [ ] `src/course-store.ts` — pass schemas to `readJson` calls in `readRegistry` and `getCourseManifest`
- [ ] `src/index-store.ts` — pass schema to `readJson` call in `loadIndex`

### 1.4 Fix unsafe `as unknown as` cast on MiniSearch search results

**Problem:** `index-store.ts:62` uses `as unknown as IndexedSearchResult[]` to cast MiniSearch results. Complete type safety bypass.

**Solution:** MiniSearch's `search()` returns `SearchResult` objects that include stored fields. Extract stored fields explicitly and construct typed objects manually rather than casting. Access each field from the result with runtime checks or use a small mapper function.

**Files:**
- [ ] `src/index-store.ts` — replace the `as unknown as` cast. Map each `SearchResult` to `SearchHit` by extracting stored fields explicitly (e.g., `result.courseId as string` or better, access via a typed helper). Consider using `result['courseId']` with the Zod schema from 1.3 to validate.

## Phase 2: Index Cache + Performance (P2)

### 2.1 In-memory MiniSearch index cache + `loadJS` instead of `loadJSON`

**Problem:** Every search reads + parses index JSON from disk for every course. Additionally, `JSON.stringify(stored.payload)` re-serializes the already-parsed payload just to pass it to `MiniSearch.loadJSON`, which parses it again. Double round-trip on every query.

**Solution:**
1. Replace `MiniSearch.loadJSON(JSON.stringify(stored.payload), ...)` with `MiniSearch.loadJS(stored.payload, ...)` — eliminates the double round-trip immediately.
2. Add a `Map<string, MiniSearch<ChunkDocument>>` cache to `CourseIndexStore`. On search, check cache first. On import (when index is rebuilt), invalidate the cache entry for that courseId.

**Files:**
- [ ] `src/index-store.ts` — add `private cache = new Map<string, MiniSearch<ChunkDocument>>()`. In `loadIndex`, check cache before disk read. In `buildIndexPayload` or a new `invalidate(courseId)` method, delete the cache entry. Use `MiniSearch.loadJS` instead of `loadJSON`.
- [ ] `src/import-service.ts` — after writing the new index file (~line 219), call `indexStore.invalidate(courseId)` (or the cache is naturally populated on next search since the file changed).

## Phase 3: Unit Tests for Pure Functions

### 3.1 Add unit tests for utilities and heuristics

**Problem:** All tests are integration tests in a single file. Pure functions with complex logic (chunking, snippets, slugify, safeResolve, course identity detection) have no isolated tests.

**Solution:** Add focused unit test files for the pure-function modules. Keep the existing integration test file as-is.

**Files:**
- [ ] `tests/utils/text.test.ts` — tests for `chunkText` (boundary detection, overlap, empty input, single chunk, multi-chunk), `buildSnippet` (match highlighting, truncation, no match), `normalizeWhitespace`, `tokenizeQuery`
- [ ] `tests/utils/fs.test.ts` — tests for `slugify` (umlauts, special chars, empty), `safeResolve` (traversal detection, empty string edge case, valid paths), `normalizeRelativePath` (outside root, absolute path, valid relative)
- [ ] `tests/utils/ocr.test.ts` — already has one test in integration file; move and expand with edge cases (empty TSV, all low confidence, missing columns)
- [ ] `tests/import-identity.test.ts` — extract and test `parseCourseMetadata`, `parseConceptFilename`, `parseFallbackStem`, `detectFolderTitle`, `buildCourseTitle`, `shortenTitle`. These are currently private functions in `import-service.ts` — either export them for testing or extract to a `src/course-identity.ts` module.

**Decision needed:** The identity detection functions are private. Two options:
- **Option A:** Extract to `src/course-identity.ts` and export (cleaner architecture, aligns with Architecture finding F-03 about import-service.ts being too large)
- **Option B:** Export from `import-service.ts` with `@internal` JSDoc (simpler, no file restructuring)

**Recommended:** Option A — it also addresses the architecture finding about `import-service.ts` being 497 lines.

## Phase 4: Dead Code Removal

### 4.1 Remove unused types and methods

**Problem:** Three unused definitions add cognitive load: `ReadDocumentResult` type, `parseResourceUri` method, `getSourceDir` method.

**Files:**
- [ ] `src/types.ts` — remove `ReadDocumentResult` interface (lines 96-105)
- [ ] `src/course-store.ts` — remove `parseResourceUri` method (lines 68-83), remove `getSourceDir` method (lines 42-44)

### 4.2 Remove redundant `initialize()` call

- [ ] `src/import-service.ts` — remove `await this.courseStore.initialize()` at line 67. Initialization is the composition root's responsibility (`server.ts:107`).

## Acceptance Criteria

- [ ] No `courseId` value can escape the data directory (test with `../../etc`)
- [ ] ZIP files with `../` path entries are rejected after extraction
- [ ] Corrupted JSON files produce clear Zod validation errors, not silent malformed objects
- [ ] No `as unknown as` casts remain in the codebase
- [ ] Repeated searches do not re-read index files from disk (verify with a counter or mock)
- [ ] `MiniSearch.loadJS` is used instead of `loadJSON` (no double serialization)
- [ ] Unit tests exist for: `chunkText`, `buildSnippet`, `slugify`, `safeResolve`, `normalizeRelativePath`, course identity detection functions
- [ ] `ReadDocumentResult`, `parseResourceUri`, `getSourceDir` are removed
- [ ] Redundant `initialize()` call is removed
- [ ] All existing tests still pass (`npm test`)
- [ ] TypeScript compiles cleanly (`npm run typecheck`)
