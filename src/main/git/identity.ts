import type { SimpleGit } from 'simple-git'
import type { GitError } from './types'
import { GitIdentity, GitIdentityField, GitIdentityInput, validateGitIdentity } from '../../shared/gitIdentity'

async function readField(git: SimpleGit, key: string): Promise<GitIdentityField> {
  const raw = await git.raw(['config', '--null', '--show-scope', '--get', key])
  if (!raw) return { value: null, scope: null }
  const [scope, value] = raw.split('\0')
  return {
    value: value ?? null,
    scope: ['local', 'global', 'system', 'worktree', 'command'].includes(scope) ? scope as GitIdentityField['scope'] : 'unknown'
  }
}

export async function readGitIdentity(git: SimpleGit): Promise<GitIdentity> {
  const name = await readField(git, 'user.name')
  const email = await readField(git, 'user.email')
  return { name, email }
}

export async function saveGitIdentity(git: SimpleGit, input: GitIdentityInput): Promise<GitIdentity> {
  const invalid = validateGitIdentity(input)
  if (invalid) throw {
    code: 'UNKNOWN', message: invalid === 'name' ? 'Enter a valid Git author name.' : 'Enter a valid Git author email.'
  } satisfies GitError
  // The option terminator keeps even a leading '-' in a name an ordinary value.
  // Explicit --local never changes another project's inherited global identity.
  await git.raw(['config', '--local', '--replace-all', '--', 'user.name', input.name])
  await git.raw(['config', '--local', '--replace-all', '--', 'user.email', input.email])
  return readGitIdentity(git)
}
