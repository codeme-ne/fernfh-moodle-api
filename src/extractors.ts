import { readFile } from "node:fs/promises";
import path from "node:path";

import { convert } from "html-to-text";

import type { AppConfig, ContentExtractionResult, ContentExtractor } from "./types.js";
import { runCommand } from "./utils/exec.js";
import { getErrorMessage } from "./utils/error.js";
import { extractTextFromTesseractTsv } from "./utils/ocr.js";
import { normalizeWhitespace } from "./utils/text.js";

const MIME_BY_EXTENSION = new Map<string, string>([
  [".csv", "text/csv"],
  [".htm", "text/html"],
  [".html", "text/html"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"]
]);

function mimeTypeForPath(filePath: string): string {
  return MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

export class DefaultContentExtractor implements ContentExtractor {
  constructor(private readonly config: AppConfig) {}

  async extract(filePath: string): Promise<ContentExtractionResult> {
    const extension = path.extname(filePath).toLowerCase();

    switch (extension) {
      case ".pdf":
        return this.extractPdf(filePath);
      case ".htm":
      case ".html":
        return this.extractHtml(filePath);
      case ".png":
      case ".jpg":
      case ".jpeg":
        return this.extractImage(filePath);
      case ".txt":
      case ".md":
      case ".csv":
      case ".json":
      case ".xml":
      case ".yaml":
      case ".yml":
        return this.extractPlainText(filePath);
      default:
        return {
          indexed: false,
          extractor: "skipped",
          mimeType: mimeTypeForPath(filePath),
          warnings: [`Unsupported file type: ${extension || "unknown"}`]
        };
    }
  }

  private async extractPlainText(filePath: string): Promise<ContentExtractionResult> {
    try {
      const text = normalizeWhitespace(await readFile(filePath, "utf8"));

      return {
        indexed: Boolean(text),
        extractor: "text",
        mimeType: mimeTypeForPath(filePath),
        text,
        warnings: text ? [] : ["File contained no usable text."]
      };
    } catch (error) {
      return {
        indexed: false,
        extractor: "text",
        mimeType: mimeTypeForPath(filePath),
        warnings: [`Text extraction failed: ${getErrorMessage(error)}`]
      };
    }
  }

  private async extractHtml(filePath: string): Promise<ContentExtractionResult> {
    try {
      const html = await readFile(filePath, "utf8");
      const text = normalizeWhitespace(
        convert(html, {
          wordwrap: false,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
            { selector: "script", format: "skip" },
            { selector: "style", format: "skip" }
          ]
        })
      );

      return {
        indexed: Boolean(text),
        extractor: "html",
        mimeType: mimeTypeForPath(filePath),
        text,
        warnings: text ? [] : ["HTML contained no usable text."]
      };
    } catch (error) {
      return {
        indexed: false,
        extractor: "html",
        mimeType: mimeTypeForPath(filePath),
        warnings: [`HTML extraction failed: ${getErrorMessage(error)}`]
      };
    }
  }

  private async extractPdf(filePath: string): Promise<ContentExtractionResult> {
    try {
      const { stdout } = await runCommand("pdftotext", [filePath, "-"]);
      const text = normalizeWhitespace(stdout);

      return {
        indexed: Boolean(text),
        extractor: "pdf",
        mimeType: mimeTypeForPath(filePath),
        text,
        warnings: text ? [] : ["PDF contained no extractable text."]
      };
    } catch (error) {
      return {
        indexed: false,
        extractor: "pdf",
        mimeType: mimeTypeForPath(filePath),
        warnings: [`PDF extraction failed: ${getErrorMessage(error)}`]
      };
    }
  }

  private async extractImage(filePath: string): Promise<ContentExtractionResult> {
    const warnings: string[] = [];
    const languageOption = this.config.ocrLanguages.join("+");
    const attempts = Array.from(new Set([languageOption, ""]));

    for (const language of attempts) {
      try {
        const args = [filePath, "stdout"];
        if (language) {
          args.push("-l", language);
        }

        args.push("quiet", "tsv");

        const { stdout } = await runCommand("tesseract", args);
        const ocrResult = extractTextFromTesseractTsv(stdout);

        if (ocrResult.text) {
          if (ocrResult.droppedWordCount > 0) {
            const confidence = ocrResult.averageConfidence?.toFixed(1);
            warnings.push(
              `OCR filtered ${ocrResult.droppedWordCount}/${ocrResult.totalWordCount} low-confidence words${
                confidence ? ` (accepted avg confidence ${confidence})` : ""
              }.`
            );
          }

          return {
            indexed: true,
            extractor: "ocr",
            mimeType: mimeTypeForPath(filePath),
            text: ocrResult.text,
            warnings
          };
        }

        if (ocrResult.totalWordCount > 0) {
          warnings.push(
            language
              ? `OCR detected only low-confidence text for language set "${language}".`
              : "OCR detected only low-confidence text."
          );
        } else {
          warnings.push(
            language
              ? `OCR returned no text for language set "${language}".`
              : "OCR returned no text."
          );
        }
      } catch (error) {
        warnings.push(
          language
            ? `OCR failed for language set "${language}": ${getErrorMessage(error)}`
            : `OCR failed: ${getErrorMessage(error)}`
        );
      }
    }

    return {
      indexed: false,
      extractor: "ocr",
      mimeType: mimeTypeForPath(filePath),
      warnings
    };
  }
}
