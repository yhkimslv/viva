export interface GitIdentityField {
  value: string | null
  scope: 'local' | 'global' | 'system' | 'worktree' | 'command' | 'unknown' | null
}

export interface GitIdentity {
  name: GitIdentityField
  email: GitIdentityField
}

export interface GitIdentityInput { name: string; email: string }

export function validateGitIdentity(input: unknown): 'name' | 'email' | null {
  const { name, email } = (input ?? {}) as Partial<GitIdentityInput>
  if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 200 || /[<>\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return 'name'
  if (typeof email !== 'string' || email.length > 254 || /[<>\s\p{Cc}\p{Cf}]/u.test(email) || !/^[^@]+@[^@]+$/.test(email)) return 'email'
  return null
}
