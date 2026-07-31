interface EmailVerificationEnvironment {
  appEnv?: string;
  isDev: boolean;
  mode: string;
}

export function resolveEmailVerificationPolicy(
  environment: EmailVerificationEnvironment
) {
  const isLocalMode =
    environment.mode === 'development' || environment.mode === 'e2e';
  const isLocalAppEnvironment =
    environment.appEnv === 'development' || environment.appEnv === 'e2e';
  // APP_ENV=e2e is an intentional quality-stack flag (vite + workerd candidate).
  // Real deploy environments never set it. Relying on import.meta.env.DEV alone
  // would skip auto-verify on the production-candidate wrangler build and leave
  // cold registration without a session (assembly-gate get-session email null).
  const autoVerifyNewUsers =
    environment.appEnv === 'e2e' ||
    (environment.isDev && (isLocalMode || isLocalAppEnvironment));

  return {
    autoVerifyNewUsers,
    requireEmailVerification: !autoVerifyNewUsers,
  };
}
