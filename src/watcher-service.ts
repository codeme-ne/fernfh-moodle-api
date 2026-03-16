import { readdir } from "node:fs/promises";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import type { AppConfig, Logger, WatchStartResult, WatchStatus } from "./types.js";
import { CourseImportService } from "./import-service.js";
import { ensureDir } from "./utils/fs.js";
import { getErrorMessage } from "./utils/error.js";

export class DownloadWatcherService {
  private watcher: FSWatcher | null = null;
  private inFlightPaths = new Set<string>();
  private state: WatchStatus = {
    active: false,
    directory: null,
    startedAt: null,
    importedCount: 0,
    lastImportedAt: null,
    lastError: null
  };

  constructor(
    private readonly config: AppConfig,
    private readonly importer: CourseImportService,
    private readonly logger?: Logger,
    private readonly onImport?: () => Promise<void> | void
  ) {}

  async watch(directory: string): Promise<WatchStartResult> {
    const resolvedDirectory = path.resolve(this.config.rootDir, directory);
    await ensureDir(resolvedDirectory);

    if (!this.state.active || this.state.directory !== resolvedDirectory) {
      await this.unwatch();

      this.state = {
        active: true,
        directory: resolvedDirectory,
        startedAt: new Date().toISOString(),
        importedCount: 0,
        lastImportedAt: null,
        lastError: null
      };

      this.watcher = chokidar.watch(resolvedDirectory, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.config.watchStabilityMs,
          pollInterval: 250
        }
      });

      this.watcher.on("add", (filePath) => {
        if (filePath.toLowerCase().endsWith(".zip")) {
          void this.handleZip(filePath);
        }
      });

      this.watcher.on("error", async (error) => {
        this.state.lastError = getErrorMessage(error);
        await this.logger?.error(`Watcher error: ${this.state.lastError}`);
      });
    }

    const importedDuringStartup = await this.importExisting(resolvedDirectory);
    return {
      ...this.state,
      importedDuringStartup
    };
  }

  async unwatch(): Promise<WatchStatus> {
    const previous = { ...this.state };

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.state = {
      active: false,
      directory: null,
      startedAt: null,
      importedCount: 0,
      lastImportedAt: previous.lastImportedAt,
      lastError: previous.lastError
    };

    return { ...this.state };
  }

  getStatus(): WatchStatus {
    return { ...this.state };
  }

  private async importExisting(directory: string): Promise<number> {
    const entries = await readdir(directory, { withFileTypes: true });
    const zipFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip"))
      .map((entry) => path.join(directory, entry.name))
      .sort();

    let imported = 0;
    for (const filePath of zipFiles) {
      if (await this.handleZip(filePath)) {
        imported += 1;
      }
    }

    return imported;
  }

  private async handleZip(filePath: string): Promise<boolean> {
    if (this.inFlightPaths.has(filePath)) {
      return false;
    }

    this.inFlightPaths.add(filePath);

    try {
      const result = await this.importer.importCourseZip(filePath);
      if (result.status !== "already_imported") {
        this.state.importedCount += 1;
        this.state.lastImportedAt = new Date().toISOString();
        await this.logger?.info(`Watcher imported ${path.basename(filePath)} as ${result.course.courseId}.`);
        await this.onImport?.();
        return true;
      }

      return false;
    } catch (error) {
      this.state.lastError = getErrorMessage(error);
      await this.logger?.error(`Watcher failed for ${filePath}: ${this.state.lastError}`);
      return false;
    } finally {
      this.inFlightPaths.delete(filePath);
    }
  }
}
