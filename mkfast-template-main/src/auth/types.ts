import type { Auth } from './auth';

/**
 * Better Auth infers the types
 * https://www.better-auth.com/docs/concepts/typescript#inferring-types
 */
export type Session = Auth['$Infer']['Session'];
export type SessionUser = Auth['$Infer']['Session']['user'];
