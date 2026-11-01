import type {ApiError} from './types.js';

/** Match Array.filter(Boolean), with nullable values removed from its result type. */
export function isPresent<T>(value: T | null | undefined): value is T {
  return Boolean(value);
}
/** Keep API conflict details on Error objects and handle non-Error rejections. */
export function asError(value: unknown): ApiError {
  return value instanceof Error ? value : new Error(String(value));
}
