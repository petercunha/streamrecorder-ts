# Repository Guidelines

## Project Structure & Module Organization
Core source is in `src/`, split by responsibility:
- `src/cli/`: command parsing and user-facing CLI flows.
- `src/daemon/`: scheduler, runtime state, and daemon HTTP control endpoints.
- `src/db/`: SQLite setup, migrations, and repository methods.
- `src/streamlink/`: Streamlink process/probe integration.
- `src/core/`: pure domain logic (target normalization, quality selection, filenames).
- `src/config/`, `src/platform/`, `src/shared/`, `src/utils/`: configuration, OS integrations, shared types/constants, utilities.

Tests live in `test/` (Vitest). Build output goes to `dist/` (generated).

## Build, Test, and Development Commands
- `npm run dev`: run CLI entrypoint with `tsx` for local iteration.
- `npm run build`: compile TypeScript (`tsc`) to `dist/`.
- `npm test`: run all tests once (`vitest run`).
- `npm run test:watch`: run tests in watch mode during development.

Example local smoke run:
`node dist/index.js --config-dir /tmp/sr-dev ls --json`

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules, strict mode).
- Indentation: 2 spaces; keep semicolons and double-quoted strings consistent with existing files.
- File names: lowercase module names (for example `quality.ts`, `ipcClient.ts`).
- Types/interfaces: `PascalCase`; functions/variables: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Keep logic modular: prefer adding helpers in `src/core/` or `src/utils/` over growing CLI handlers.

## Testing Guidelines
- Framework: Vitest.
- Test files: `*.test.ts` under `test/`.
- Add/adjust tests for any behavior change, especially:
  - quality fallback rules (`src/core/quality.ts`)
  - target normalization (`src/core/target.ts`)
  - CLI-visible behavior changes.
- Run `npm test` and `npm run build` before opening a PR.

## Commit & Pull Request Guidelines
Current history uses short imperative commit messages (for example `Add sr status`, `Init`). Follow that style:
- one-line imperative subject, specific to the change.
- keep unrelated refactors out of feature commits.

PRs should include:
- what changed and why,
- test/build results,
- CLI examples for user-facing changes (`sr ls`, `sr status`, etc.),
- any platform-specific notes (macOS/Linux/Windows daemon behavior).

## Security & Configuration Tips
- Runtime state is outside the repo (default `~/.config/streamrecorder`); do not commit local DB/runtime artifacts.
- Treat daemon runtime tokens and local paths as sensitive operational data.
- Prefer `--config-dir` with a temp path when running manual smoke tests.
