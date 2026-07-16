export interface OfflinePasswordResetRepository {
  resetCredential(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ revokedSessions: number; userId: string }>;
}

export interface OfflinePasswordResetResult {
  email: string;
  revokedSessions: number;
  userId: string;
}

export function parseOfflinePasswordResetArguments(arguments_: string[]) {
  let email = '';
  let passwordStdin = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (index === 0 && argument === '--') continue;
    if (argument === '--email') {
      email = arguments_[index + 1]?.trim() ?? '';
      index += 1;
      continue;
    }
    if (argument === '--password-stdin') {
      passwordStdin = true;
      continue;
    }
    throw new Error(`Unknown offline password reset argument: ${argument}`);
  }
  if (!email) throw new Error('--email is required.');
  if (!passwordStdin) throw new Error('--password-stdin is required.');
  return { email, passwordStdin: true as const };
}

export async function resetPasswordOffline(
  input: { email: string; password: string },
  dependencies: {
    hashPassword: (password: string) => Promise<string>;
    repository: OfflinePasswordResetRepository;
  }
): Promise<OfflinePasswordResetResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('A valid account email is required.');
  }
  if (input.password.length < 12) {
    throw new Error('Password must contain at least 12 characters.');
  }
  if (input.password.length > 128) {
    throw new Error('Password must contain at most 128 characters.');
  }
  const passwordHash = await dependencies.hashPassword(input.password);
  const result = await dependencies.repository.resetCredential({
    email,
    passwordHash,
  });
  return { email, ...result };
}
