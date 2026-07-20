/**
 * Domain errors for visual-adoption / result-delivery writes.
 * status is preserved for HTTP 404/409 fidelity (not swallowed).
 */
export class VisualAdoptionError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | 'CONTENT_PACKAGE_NOT_FOUND'
      | 'CONTENT_PACKAGE_REVISION_CONFLICT'
      | 'CONTENT_PACKAGE_VERSION_CONFLICT'
      | 'CONTENT_PACKAGE_NOT_REVISABLE'
      | 'DUPLICATE_VISUAL_ASSET'
      | 'INVALID_VISUAL_ASSET'
      | 'VISUAL_ASSET_REQUIRED'
      | 'INVALID_COMMAND',
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'VisualAdoptionError';
    this.status =
      status ??
      (code === 'CONTENT_PACKAGE_NOT_FOUND'
        ? 404
        : code === 'VISUAL_ASSET_REQUIRED' ||
            code === 'DUPLICATE_VISUAL_ASSET' ||
            code === 'INVALID_COMMAND'
          ? 400
          : 409);
  }
}
