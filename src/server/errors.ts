export class ServiceError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export function safeError(error: unknown): string {
  return error instanceof ServiceError ? error.code : 'INTERNAL_ERROR';
}
