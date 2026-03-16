import path from "node:path";

import MiniSearch from "minisearch";

import type { AppConfig, ChunkDocument, SearchHit, StoredCourseIndex } from "./types.js";
import { pathExists, readJson } from "./utils/fs.js";
import { buildSnippet } from "./utils/text.js";

const INDEX_OPTIONS = {
  idField: "id",
  fields: ["text", "documentTitle", "documentPath", "courseTitle"] as string[],
  storeFields: [
    "id",
    "courseId",
    "courseTitle",
    "documentPath",
    "documentTitle",
    "mimeType",
    "chunkIndex",
    "startOffset",
    "endOffset",
    "text",
    "resourceUri"
  ] as string[]
};

interface IndexedSearchResult extends ChunkDocument {
  score: number;
}

export class CourseIndexStore {
  constructor(private readonly config: AppConfig) {}

  buildIndexPayload(courseId: string, chunks: ChunkDocument[]): StoredCourseIndex {
    const index = new MiniSearch<ChunkDocument>(INDEX_OPTIONS);
    index.addAll(chunks);

    return {
      version: 1,
      courseId,
      indexedAt: new Date().toISOString(),
      chunks: chunks.length,
      payload: index.toJSON()
    };
  }

  async search(courseIds: string[], query: string, limit: number): Promise<SearchHit[]> {
    const indexes = await Promise.all(courseIds.map((courseId) => this.loadIndex(courseId)));
    const allHits = indexes.flatMap((index) => {
      if (!index) {
        return [];
      }

      return (index.search(query, {
        prefix: true,
        fuzzy: 0.1,
        boost: {
          documentTitle: 2,
          documentPath: 1.5,
          courseTitle: 1.25
        }
      }) as unknown as IndexedSearchResult[]).map((result) => ({
        courseId: result.courseId,
        courseTitle: result.courseTitle,
        documentPath: result.documentPath,
        documentTitle: result.documentTitle,
        mimeType: result.mimeType,
        chunkIndex: result.chunkIndex,
        score: result.score,
        snippet: buildSnippet(result.text, query),
        resourceUri: result.resourceUri
              }));
    });

    const sortedHits = allHits.sort((left, right) => right.score - left.score);
    const groupedHits = new Map<string, SearchHit[]>();

    for (const hit of sortedHits) {
      const groupKey = `${hit.courseId}:${hit.documentPath}`;
      const documentHits = groupedHits.get(groupKey) ?? [];
      documentHits.push(hit);
      groupedHits.set(groupKey, documentHits);
    }

    const documentGroups = [...groupedHits.values()];
    const diversifiedHits: SearchHit[] = [];
    let depth = 0;

    while (diversifiedHits.length < limit) {
      let addedAny = false;

      for (const group of documentGroups) {
        const hit = group[depth];
        if (!hit) {
          continue;
        }

        diversifiedHits.push(hit);
        addedAny = true;

        if (diversifiedHits.length >= limit) {
          break;
        }
      }

      if (!addedAny) {
        break;
      }

      depth += 1;
    }

    return diversifiedHits;
  }

  private async loadIndex(courseId: string): Promise<MiniSearch<ChunkDocument> | null> {
    const indexPath = path.join(this.config.indexDir, `${courseId}.json`);
    if (!(await pathExists(indexPath))) {
      return null;
    }

    const stored = await readJson<StoredCourseIndex | null>(indexPath, null);
    if (!stored) {
      return null;
    }

    return MiniSearch.loadJSON<ChunkDocument>(JSON.stringify(stored.payload), INDEX_OPTIONS);
  }
}
