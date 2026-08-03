type RuntimeEnv = {
  HYPERDRIVE?: { connectionString?: unknown };
};

export class DatabaseBindingUnavailableError extends Error {
  constructor() {
    super('Database binding is unavailable.');
    this.name = 'DatabaseBindingUnavailableError';
  }
}

export function hasDatabaseBinding(value: unknown): value is RuntimeEnv & {
  HYPERDRIVE: { connectionString: string };
} {
  if (!value || typeof value !== 'object') return false;
  const hyperdrive = (value as RuntimeEnv).HYPERDRIVE;
  return (
    typeof hyperdrive?.connectionString === 'string' &&
    hyperdrive.connectionString.trim().length > 0
  );
}
