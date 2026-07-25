export interface AdminCreateUserInput {
  name: string;
  email: string;
  password: string;
}

export function canCreateAdminUser(input: AdminCreateUserInput) {
  return (
    input.name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) &&
    input.password.length >= 8
  );
}
