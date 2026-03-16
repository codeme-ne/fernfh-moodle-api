import { normalizeWhitespace } from "./text.js";

const MIN_ACCEPTED_WORD_CONFIDENCE = 45;

export interface OcrExtractionStats {
  text: string;
  totalWordCount: number;
  acceptedWordCount: number;
  droppedWordCount: number;
  averageConfidence: number | null;
}

export function extractTextFromTesseractTsv(tsv: string): OcrExtractionStats {
  const groupedLines = new Map<string, string[]>();
  let totalWordCount = 0;
  let acceptedWordCount = 0;
  let droppedWordCount = 0;
  let confidenceSum = 0;

  for (const rawLine of tsv.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith("level\t")) {
      continue;
    }

    const columns = rawLine.split("\t");
    if (columns.length < 12 || columns[0] !== "5") {
      continue;
    }

    const confidence = Number.parseFloat(columns[10] ?? "");
    const text = normalizeWhitespace(columns.slice(11).join("\t"));
    if (!text || !Number.isFinite(confidence) || confidence < 0) {
      continue;
    }

    totalWordCount += 1;

    if (confidence < MIN_ACCEPTED_WORD_CONFIDENCE) {
      droppedWordCount += 1;
      continue;
    }

    acceptedWordCount += 1;
    confidenceSum += confidence;

    const lineKey = [columns[1], columns[2], columns[3], columns[4]].join(":");
    const lineWords = groupedLines.get(lineKey) ?? [];
    lineWords.push(text);
    groupedLines.set(lineKey, lineWords);
  }

  const text = normalizeWhitespace(
    [...groupedLines.values()]
      .map((lineWords) => lineWords.join(" "))
      .join("\n")
  );

  return {
    text,
    totalWordCount,
    acceptedWordCount,
    droppedWordCount,
    averageConfidence: acceptedWordCount > 0 ? confidenceSum / acceptedWordCount : null
  };
}
