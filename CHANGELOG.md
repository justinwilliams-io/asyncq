# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-07-31

### Fixed

- Published types no longer reference global `AbortSignal` (which is undefined without DOM lib)
- Moved public types to `src/types` and introduced structural `AbortSignalLike`

## [0.3.0] - 2026-07-31

### Added

- `clear(rejectPending?)` — drop pending jobs (rejects with `QueueClearedError` by default)
- Mutable `concurrency` getter/setter with validation
- `onIdle()` — resolves when `active` and `pending` are both zero
- Optional `AbortSignal` via `limit(fn, { signal })` (cancels while pending only)
- Exported `AbortError` and `QueueClearedError` classes

## [0.1.0] - 2026-07-31

### Added

- Initial release as `@justinwilliams-io/asyncq`
- `asyncq(maxRunning)` concurrency limiter with FIFO queueing
- Named and default exports
- `active` and `pending` getters on the returned limiter
- Validation for invalid `maxRunning` values
- Dual ESM/CJS builds with TypeScript types
