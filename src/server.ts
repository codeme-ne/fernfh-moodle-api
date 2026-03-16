import path from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { resolveConfig } from "./config.js";
import { CourseStore } from "./course-store.js";
import { DefaultContentExtractor } from "./extractors.js";
import { CourseImportService } from "./import-service.js";
import { CourseIndexStore } from "./index-store.js";
import type { CourseManifest, Logger } from "./types.js";
import { DownloadWatcherService } from "./watcher-service.js";

export interface StudyMaterialsServer extends McpServer {
  startBackgroundServices(): Promise<void>;
}

const courseSummarySchema = z.object({
  courseId: z.string(),
  title: z.string(),
  sourceZipName: z.string(),
  sourceHash: z.string(),
  importedAt: z.string(),
  updatedAt: z.string(),
  documentCount: z.number(),
  indexedDocumentCount: z.number(),
  chunkCount: z.number()
});

const searchHitSchema = z.object({
  courseId: z.string(),
  courseTitle: z.string(),
  documentPath: z.string(),
  documentTitle: z.string(),
  mimeType: z.string(),
  chunkIndex: z.number(),
  score: z.number(),
  snippet: z.string(),
  resourceUri: z.string()
});

function formatImportResult(status: string, courseId: string, title: string, warnings: string[]): string {
  const heading =
    status === "already_imported"
      ? `Course ${courseId} is already imported.`
      : `${status === "updated" ? "Updated" : "Imported"} ${courseId} (${title}).`;

  if (!warnings.length) {
    return heading;
  }

  const sampleWarnings = warnings.slice(0, 5).map((warning) => `- ${warning}`).join("\n");
  return `${heading}\nWarnings:\n${sampleWarnings}${warnings.length > 5 ? "\n- ..." : ""}`;
}

function formatWatchStatus(result: {
  directory: string | null;
  importedCount: number;
  importedDuringStartup?: number;
}): string {
  return [
    `Watching: ${result.directory ?? "not active"}`,
    `Imported while watching: ${result.importedCount}`,
    `Imported on startup scan: ${result.importedDuringStartup ?? 0}`
  ].join("\n");
}

function normalizeTemplateVariable(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export async function createStudyMaterialsServer(): Promise<StudyMaterialsServer> {
  const config = resolveConfig();
  const server = new McpServer(
    {
      name: "fernfh-study-materials",
      version: "0.1.0"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  const logger: Logger = {
    info: async (message) => {
      await server.sendLoggingMessage({ level: "info", data: message });
    },
    error: async (message) => {
      await server.sendLoggingMessage({ level: "error", data: message });
    }
  };

  const courseStore = new CourseStore(config);
  const indexStore = new CourseIndexStore(config);
  const extractor = new DefaultContentExtractor(config);
  const importService = new CourseImportService(config, courseStore, indexStore, extractor, logger);
  const watcherService = new DownloadWatcherService(config, importService, logger, async () => {
    server.sendResourceListChanged();
  });

  await courseStore.initialize();

  server.registerTool(
    "import_course_zip",
    {
      title: "Import Course ZIP",
      description: "Import, unpack, OCR, and index a FernFH course ZIP archive.",
      inputSchema: {
        path: z.string().describe("Absolute or repo-relative path to a ZIP archive.")
      },
      outputSchema: {
        status: z.enum(["imported", "updated", "already_imported"]),
        course: courseSummarySchema,
        warnings: z.array(z.string())
      }
    },
    async ({ path: zipPath }) => {
      const result = await importService.importCourseZip(zipPath);
      if (result.status !== "already_imported") {
        server.sendResourceListChanged();
      }

      return {
        content: [
          {
            type: "text",
            text: formatImportResult(result.status, result.course.courseId, result.course.title, result.warnings)
          }
        ],
        structuredContent: {
          status: result.status,
          course: result.course,
          warnings: result.warnings
        }
      };
    }
  );

  server.registerTool(
    "list_courses",
    {
      title: "List Courses",
      description: "List all locally imported courses.",
      outputSchema: {
        courses: z.array(courseSummarySchema)
      }
    },
    async () => {
      const courses = await courseStore.listCourses();
      const text =
        courses.length === 0
          ? "No courses imported yet."
          : courses.map((course) => `- ${course.courseId}: ${course.title}`).join("\n");

      return {
        content: [
          {
            type: "text",
            text
          }
        ],
        structuredContent: {
          courses
        }
      };
    }
  );

  server.registerTool(
    "search_course",
    {
      title: "Search Courses",
      description: "Search imported course material and return the most relevant snippets.",
      inputSchema: {
        query: z.string().min(1).describe("Search query."),
        courseId: z.string().optional().describe("Optional course ID to narrow the search."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum number of results to return.")
      },
      outputSchema: {
        hits: z.array(searchHitSchema)
      }
    },
    async ({ query, courseId, limit }) => {
      const courseIds = courseId
        ? [courseId]
        : (await courseStore.listCourses()).map((course) => course.courseId);

      const hits = courseIds.length
        ? await indexStore.search(courseIds, query, limit ?? config.defaultSearchLimit)
        : [];

      const text =
        hits.length === 0
          ? "No matching snippets found."
          : hits
              .map(
                (hit, index) =>
                  `${index + 1}. ${hit.courseId} ${hit.documentPath}\n${hit.snippet}\nResource: ${hit.resourceUri}`
              )
              .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text
          }
        ],
        structuredContent: {
          hits
        }
      };
    }
  );

  server.registerTool(
    "read_document",
    {
      title: "Read Document",
      description: "Read extracted text for one document.",
      inputSchema: {
        courseId: z.string().describe("Course ID."),
        path: z.string().describe("Relative path of the document inside the course ZIP."),
        offset: z.number().int().min(0).optional().describe("Character offset into the text."),
        length: z
          .number()
          .int()
          .min(1)
          .max(20000)
          .optional()
          .describe("Maximum number of characters to return.")
      },
      outputSchema: {
        courseId: z.string(),
        documentPath: z.string(),
        mimeType: z.string(),
        totalLength: z.number(),
        offset: z.number(),
        length: z.number(),
        text: z.string(),
        resourceUri: z.string()
      }
    },
    async ({ courseId, path: documentPath, offset, length }) => {
      const result = await courseStore.readDocument(courseId, documentPath);
      if (!result) {
        throw new Error(`Document not found or not indexed: ${courseId} ${documentPath}`);
      }

      const start = offset ?? 0;
      const sliceLength = length ?? config.defaultReadLength;
      const text = result.text.slice(start, start + sliceLength);

      return {
        content: [
          {
            type: "text",
            text
          }
        ],
        structuredContent: {
          courseId,
          documentPath,
          mimeType: result.document.mimeType,
          totalLength: result.text.length,
          offset: start,
          length: text.length,
          text,
          resourceUri: result.document.resourceUri
        }
      };
    }
  );

  server.registerTool(
    "watch_downloads",
    {
      title: "Watch Download Folder",
      description: "Watch a directory for new ZIP files and import them automatically.",
      inputSchema: {
        path: z.string().describe("Absolute or repo-relative directory path to watch.")
      },
      outputSchema: {
        active: z.boolean(),
        directory: z.string().nullable(),
        startedAt: z.string().nullable(),
        importedCount: z.number(),
        lastImportedAt: z.string().nullable(),
        lastError: z.string().nullable(),
        importedDuringStartup: z.number()
      }
    },
    async ({ path: watchPath }) => {
      const result = await watcherService.watch(watchPath);
      return {
        content: [
          {
            type: "text",
            text: formatWatchStatus(result)
          }
        ],
        structuredContent: { ...result }
      };
    }
  );

  server.registerTool(
    "unwatch_downloads",
    {
      title: "Stop Watching Downloads",
      description: "Stop watching the current download directory.",
      outputSchema: {
        active: z.boolean(),
        directory: z.string().nullable(),
        startedAt: z.string().nullable(),
        importedCount: z.number(),
        lastImportedAt: z.string().nullable(),
        lastError: z.string().nullable()
      }
    },
    async () => {
      const previousStatus = watcherService.getStatus();
      const result = await watcherService.unwatch();
      return {
        content: [
          {
            type: "text",
            text: `Stopped watching ${previousStatus.directory ?? "downloads"}`
          }
        ],
        structuredContent: { ...result }
      };
    }
  );

  server.registerResource(
    "course-catalog",
    "course://catalog",
    {
      title: "Course Catalog",
      description: "JSON catalog of imported courses.",
      mimeType: "application/json"
    },
    async () => {
      const courses = await courseStore.listCourses();
      return {
        contents: [
          {
            uri: "course://catalog",
            mimeType: "application/json",
            text: JSON.stringify({ courses }, null, 2)
          }
        ]
      };
    }
  );

  const documentTemplate = new ResourceTemplate("course://documents/{courseId}/{documentId}", {
    list: async () => {
      const manifests = await courseStore.listCourseManifests();
      return {
        resources: manifests.flatMap((manifest) =>
          buildDocumentResources(manifest).map((resource) => ({
            ...resource,
            mimeType: "text/plain"
          }))
        )
      };
    },
    complete: {
      courseId: async (value) => {
        const courses = await courseStore.listCourses();
        return courses
          .map((course) => course.courseId)
          .filter((courseId) => courseId.toLowerCase().startsWith(value.toLowerCase()));
      }
    }
  });

  server.registerResource(
    "course-document",
    documentTemplate,
    {
      title: "Course Document",
      description: "Extracted text for an imported course document.",
      mimeType: "text/plain"
    },
    async (uri, variables) => {
      const courseId = decodeURIComponent(normalizeTemplateVariable(variables.courseId));
      const documentPath = decodeURIComponent(normalizeTemplateVariable(variables.documentId));
      const result = await courseStore.readDocument(courseId, documentPath);
      if (!result) {
        throw new Error(`Document not found or not indexed: ${courseId} ${documentPath}`);
      }

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/plain",
            text: result.text
          }
        ]
      };
    }
  );

  let backgroundServicesStarted = false;

  return Object.assign(server, {
    async startBackgroundServices(): Promise<void> {
      if (backgroundServicesStarted) {
        return;
      }

      backgroundServicesStarted = true;
      await watcherService.watch(config.rawDir);
    }
  }) as StudyMaterialsServer;
}

function buildDocumentResources(manifest: CourseManifest) {
  return manifest.documents
    .filter((document) => document.indexed)
    .map((document) => ({
      uri: document.resourceUri,
      name: path.basename(document.relativePath),
      title: `${manifest.title}: ${document.relativePath}`,
      description: `Extracted text for ${manifest.courseId}/${document.relativePath}`
    }));
}
