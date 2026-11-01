// Generated from frontend/utils.ts by pnpm build. Do not edit.
/** Match Array.filter(Boolean), with nullable values removed from its result type. */
export function isPresent(value) {
    return Boolean(value);
}
/** Keep API conflict details on Error objects and handle non-Error rejections. */
export function asError(value) {
    return value instanceof Error ? value : new Error(String(value));
}
