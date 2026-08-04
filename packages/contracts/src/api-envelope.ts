import { z } from 'zod';

export const API_ERROR_CODES = [
  'ASSET_DELETE_FAILED',
  'ASSET_DELETE_UNAVAILABLE',
  'ASSET_NOT_FOUND',
  'ASSET_WORKSPACE_FORBIDDEN',
  'ASSET_WRITE_UNAVAILABLE',
  'ASSISTANT_STREAM_FAILED',
  'CANVAS_ASSET_TOO_LARGE',
  'CANVAS_TEXT_STREAM_FAILED',
  'CAPABILITIES_UNAVAILABLE',
  'COMPOSER_CONTENT_PACKAGE_UNAVAILABLE',
  'COMPOSER_EVENTS_UNAVAILABLE',
  'DIAGNOSTIC_CONTENT_GENERATION_RETIRED',
  'HARNESS_ACTIVE_TASKS_UNAVAILABLE',
  'HARNESS_INTERACTION_VERSION_REQUIRED',
  'HARNESS_RECOMMENDATION_UNAVAILABLE',
  'HARNESS_TASK_ADMISSION_RETIRED',
  'INTERNAL_ERROR',
  'INVALID_ASSET_KEY',
  'INVALID_ASSET_PAYLOAD',
  'INVALID_COMMAND',
  'INVALID_COMPOSER_DESTINATION',
  'INVALID_COMPOSER_SUBMISSION',
  'INVALID_HARNESS_INTERACTION',
  'INVALID_HARNESS_INTERACTION_EDITING',
  'INVALID_HARNESS_INTERACTION_MESSAGE',
  'INVALID_HARNESS_INTERACTION_RENDERER',
  'INVALID_HARNESS_PRODUCT_METRIC',
  'INVALID_HARNESS_REQUEST',
  'INVALID_QUERY',
  'INVALID_STATE',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'PENDING_ACTIONS_UNAVAILABLE',
  'PLAN_CATALOG_UNAVAILABLE',
  'RUN_NOT_FOUND',
  'UNAUTHORIZED_IDENTITY',
  'UNAUTHORIZED_SERVICE',
  'WORKFLOW_EVENTS_UNAVAILABLE',
  'WORKSPACE_BOOTSTRAP_FAILED',
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type KnownApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/**
 * DomainError and OperationsError are intentionally open-ended legacy
 * channels. Keep their values distinguishable until those constructors are
 * narrowed at their owning modules.
 */
export type UnregisteredApiErrorCode = string & {
  readonly __unregisteredApiErrorCode?: never;
};

export type ApiErrorCode = KnownApiErrorCode | UnregisteredApiErrorCode;

export interface ApiMeta {
  correlationId: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;
