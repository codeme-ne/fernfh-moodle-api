# fernfh-s2

## Goal
MCP server for importing, indexing, and searching FernFH study materials from ZIP exports.
Exposes tools via stdio transport for use in Claude Code, Codex, etc.

## Stack
TypeScript (ES2022, NodeNext), Node 24+, MCP SDK, MiniSearch, Zod v4, Vitest
External tools: `unzip`, `pdftotext` (poppler), `tesseract` (OCR)

## Commands
```bash
npm install
npm run build        # tsc → dist/
npm run dev          # tsx watch
npm start            # run built server (stdio)
npm test             # vitest run
npm run test:watch   # vitest watch
npm run typecheck    # tsc --noEmit
```

## Architecture
- `src/index.ts` — entry point, stdio transport
- `src/server.ts` — MCP server setup, tool/resource registration
- `src/config.ts` — env-var-driven config resolution
- `src/course-store.ts` — course manifest persistence
- `src/index-store.ts` — MiniSearch full-text index
- `src/import-service.ts` — ZIP import pipeline
- `src/extractors.ts` — content extraction (PDF, HTML, text)
- `src/watcher-service.ts` — chokidar file watcher for downloads
- `src/utils/` — exec, fs, text, ocr, error helpers

## Environment Variables
- `FERNFH_S2_DATA_DIR` — data directory (default: `./data`)
- `FERNFH_S2_OCR_LANGS` — OCR languages (default: `eng+deu`)
- `FERNFH_S2_CHUNK_SIZE` — index chunk size (default: `1200`)
- `FERNFH_S2_CHUNK_OVERLAP` — chunk overlap (default: `200`)
- `FERNFH_S2_READ_LENGTH` — read_document default length (default: `4000`)

## Gotchas
- Server uses `console.error` for logging (stdout is reserved for MCP stdio)
- Zod imported as `zod/v4` (not `zod`) — this is Zod v4 syntax
- `tsconfig.json` has `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` — stricter than default
