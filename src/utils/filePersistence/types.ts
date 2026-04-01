/**
 * Published npm tarball omits this module; minimal shims for local esbuild.
 * Adjust constants if you need to match upstream behavior.
 */
export const DEFAULT_UPLOAD_CONCURRENCY = 4
export const FILE_COUNT_LIMIT = 500
export const OUTPUTS_SUBDIR = 'outputs'

export type FailedPersistence = { path: string; error: string }
export type FilesPersistedEventData = Record<string, unknown>
export type PersistedFile = { path: string; id?: string }
export type TurnStartTime = number
