export interface TextChunk {
  index: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

function findBoundary(text: string, start: number, end: number): number {
  if (end >= text.length) {
    return text.length;
  }

  const minimumBoundary = start + Math.floor((end - start) * 0.6);
  const candidates: Array<{ needle: string; advance: number }> = [
    { needle: "\n\n", advance: 2 },
    { needle: "\n", advance: 1 },
    { needle: ". ", advance: 1 },
    { needle: "; ", advance: 1 },
    { needle: ", ", advance: 1 },
    { needle: " ", advance: 0 }
  ];

  for (const candidate of candidates) {
    const position = text.lastIndexOf(candidate.needle, end);
    if (position >= minimumBoundary) {
      return position + candidate.advance;
    }
  }

  return end;
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function tokenizeQuery(query: string): string[] {
  const matches = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return matches ?? [];
}

export function chunkText(text: string, chunkSize: number, overlap: number): TextChunk[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    const targetEnd = Math.min(normalized.length, start + chunkSize);
    const boundaryEnd = findBoundary(normalized, start, targetEnd);
    const slice = normalized.slice(start, boundaryEnd);
    const leadingWhitespace = slice.match(/^\s*/u)?.[0].length ?? 0;
    const trailingWhitespace = slice.match(/\s*$/u)?.[0].length ?? 0;
    const actualStart = start + leadingWhitespace;
    const actualEnd = Math.max(actualStart, boundaryEnd - trailingWhitespace);
    const value = normalized.slice(actualStart, actualEnd).trim();

    if (value) {
      chunks.push({
        index,
        startOffset: actualStart,
        endOffset: actualEnd,
        text: value
      });
      index += 1;
    }

    if (boundaryEnd >= normalized.length) {
      break;
    }

    start = Math.max(actualEnd - overlap, start + 1);
    while (start < normalized.length && /\s/u.test(normalized[start] ?? "")) {
      start += 1;
    }
  }

  return chunks;
}

export function buildSnippet(text: string, query: string, maxLength = 240): string {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const lowerCase = normalized.toLowerCase();
  const terms = tokenizeQuery(query).filter((term) => term.length > 1);
  const matchIndex = terms.reduce<number>((bestIndex, term) => {
    const currentIndex = lowerCase.indexOf(term);
    if (currentIndex === -1) {
      return bestIndex;
    }

    return bestIndex === -1 ? currentIndex : Math.min(bestIndex, currentIndex);
  }, -1);

  const start = matchIndex === -1 ? 0 : Math.max(0, matchIndex - Math.floor(maxLength / 3));
  const end = Math.min(normalized.length, start + maxLength);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalized.length ? "..." : "";

  return `${prefix}${normalized.slice(start, end).trim()}${suffix}`;
}
