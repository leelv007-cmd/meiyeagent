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
  const autoVerifyNewUsers =
    environment.isDev && (isLocalMode || isLocalAppEnvironment);

  return {
    autoVerifyNewUsers,
    requireEmailVerification: !autoVerifyNewUsers,
  };
}
