import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectRepositoryConnection } from '../inspectRepositoryConnection'

// Connection checks should never enumerate project files, even when a folder
// contains large or inaccessible subdirectories.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readdir: vi.fn(() => { throw new Error('Connection checks must not scan files') })
}))

const execute = promisify(execFile)
const directories: string[] = []

async function fixture(initialize = true) {
  const directory = await mkdtemp(join(tmpdir(), 'viva-repository-connection-'))
  directories.push(directory)
  const git = async (...args: string[]) => (await execute('git', args, { cwd: directory })).stdout
  if (initialize) await git('init')
  return { directory, git }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('inspectRepositoryConnection', () => {
  it('distinguishes a plain folder from a repository with no remotes', async () => {
    const plain = await fixture(false)
    const repository = await fixture()

    expect(await inspectRepositoryConnection(plain.directory)).toEqual({
      isGitRepo: false,
      remotes: []
    })
    expect(await inspectRepositoryConnection(repository.directory)).toEqual({
      isGitRepo: true,
      remotes: []
    })
  })

  it('returns all configured fetch and push URLs without contacting remotes or scanning files', async () => {
    const { directory, git } = await fixture()
    await git('remote', 'add', 'origin', 'https://github.com/example/project.git')
    await git('remote', 'set-url', '--push', 'origin', 'git@github.com:example/project.git')
    await git('remote', 'add', 'upstream', 'https://gitlab.example.invalid/team/project.git')
    const configPath = join(directory, '.git', 'config')
    const originalConfig = await readFile(configPath, 'utf8')

    const result = await inspectRepositoryConnection(directory)

    expect(result).toEqual({
      isGitRepo: true,
      remotes: [
        {
          name: 'origin',
          fetch: 'https://github.com/example/project.git',
          push: 'git@github.com:example/project.git'
        },
        {
          name: 'upstream',
          fetch: 'https://gitlab.example.invalid/team/project.git',
          push: 'https://gitlab.example.invalid/team/project.git'
        }
      ]
    })
    expect(await readFile(configPath, 'utf8')).toBe(originalConfig)
    await expect(access(join(directory, '.git', 'FETCH_HEAD'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves Git discovery for a subfolder inside a repository', async () => {
    const { directory, git } = await fixture()
    await git('remote', 'add', 'origin', 'git@github.com:example/parent.git')
    const child = join(directory, 'subfolder')
    await mkdir(child)

    expect(await inspectRepositoryConnection(child)).toEqual({
      isGitRepo: true,
      remotes: [{
        name: 'origin',
        fetch: 'git@github.com:example/parent.git',
        push: 'git@github.com:example/parent.git'
      }]
    })
  })
})
