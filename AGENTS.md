# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the TypeScript ESM source. Key modules are `server.ts` for MCP tool wiring, `import-service.ts` for ZIP ingestion, `course-store.ts` and `index-store.ts` for persistence/search, and `watcher-service.ts` for download-folder monitoring.
- `src/utils/` holds focused helpers for filesystem, OCR, shell execution, and text processing.
- `tests/fernfh-s2.test.ts` contains the Vitest suite; tests are integration-style and exercise services end to end with stubs.
- `docs/` stores plans and operational notes. See `docs/fernfh-moodle-dl.md` for the FernFH Moodle token/download workflow.
- Generated or local-only paths include `dist/`, `data/`, `downloads/`, `.venv/`, and `config.json`.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: run `src/index.ts` with `tsx` in watch mode for local development.
- `npm run build`: compile TypeScript into `dist/`.
- `npm start`: run the built MCP server over stdio from `dist/index.js`.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: run tests in watch mode.
- `npm run typecheck`: run a strict TypeScript check without emitting files.

## Coding Style & Naming Conventions

- Follow the existing style: 2-space indentation, double quotes, semicolons, and small, single-purpose modules.
- Use TypeScript ESM imports and keep explicit `.js` extensions for local imports.
- Prefer `kebab-case` filenames such as `course-store.ts`, `PascalCase` for classes, and `camelCase` for functions, variables, and instances.
- Keep utility logic in `src/utils/`; keep module-specific types and helpers near the consuming file unless reused broadly.

## Testing Guidelines

- Add tests under `tests/*.test.ts` using Vitest.
- Prefer service-level tests that cover ZIP import, indexing, search, and watcher behavior.
- Stub extractors and external tools where practical; use temporary workspaces and clean them up in `afterEach`.
- Before opening a PR, run `npm test && npm run typecheck`.

## Commit & Pull Request Guidelines

- This repository currently has no commit history on `master`, so no existing commit convention can be inferred.
- Use short, imperative Conventional Commit messages such as `feat: add ZIP watcher filter` or `docs: add Moodle setup notes`.
- PRs should include a concise summary, rationale, test commands run, and any relevant sample MCP behavior if tool output changes.

## Security & Configuration Tips

- Never commit `config.json`, `cookie.txt`, `downloads/`, or logs that may contain tokens.
- Treat Moodle `token` and `privatetoken` values as credentials.
- Local import/OCR workflows expect `unzip`, `pdftotext`, and `tesseract` to be installed.
