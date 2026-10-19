import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { simpleGit } from 'simple-git'
import { GitService } from '../service'

const directories: string[] = []
// Git for Windows translates this spelling; Node's os.devNull is not accepted.
const gitEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'viva-collaboration-'))
  directories.push(directory)
  const remote = join(directory, 'team.git')
  const work = join(directory, 'work')
  await mkdir(work)
  git(directory, 'init', '--bare', '--initial-branch=main', remote)
  git(work, 'init', '--initial-branch=main')
  git(work, 'config', 'user.name', 'VIVA test')
  git(work, 'config', 'user.email', 'viva@example.test')
  git(work, 'config', 'commit.gpgsign', 'false')
  await writeFile(join(work, 'notes.txt'), 'initial\n')
  git(work, 'add', '.')
  git(work, 'commit', '-m', 'Initial')
  git(work, 'remote', 'add', 'origin', remote)
  git(work, 'push', '-u', 'origin', 'main')
  return { directory, remote, work, service: new GitService(work) }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('collaboration with real local git repositories', () => {
  it('uploads the same work branch twice and keeps a named, credential-free upstream', async () => {
    const { work, remote, service } = await fixture()
    // Exercise the HTTPS authentication code without contacting the network.
    git(work, 'config', `url.${pathToFileURL(remote).href}.insteadOf`, 'https://github.com/team/project.git')
    git(work, 'remote', 'set-url', 'origin', 'https://github.com/team/project.git')
    const input = {
      mode: 'collaboration' as const, remoteName: 'origin', branchMode: 'new_branch' as const,
      branchName: 'feature/work', token: 'github_pat_test_only'
    }
    await service.pushConfiguredTarget(input)
    await writeFile(join(work, 'notes.txt'), 'second upload\n')
    git(work, 'commit', '-am', 'Second save')
    await service.pushConfiguredTarget(input)

    expect(git(remote, 'rev-parse', 'refs/heads/feature/work')).toBe(git(work, 'rev-parse', 'HEAD'))
    expect(git(work, 'config', 'branch.feature/work.remote')).toBe('origin')
    const config = await readFile(join(work, '.git/config'), 'utf8')
    expect(config).not.toContain(input.token)
    expect(config).not.toContain(Buffer.from(`oauth2:${input.token}`).toString('base64'))
  })

  it('protects a custom default branch even without a cached origin/HEAD', async () => {
    const { work, remote, service } = await fixture()
    git(work, 'checkout', '-b', 'release')
    git(work, 'push', 'origin', 'release')
    git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/release')
    await expect(service.pushConfiguredTarget({
      mode: 'collaboration', remoteName: 'origin', branchMode: 'existing_branch', branchName: 'release'
    })).rejects.toMatchObject({ code: 'DEFAULT_BRANCH_PROTECTED' })
  })

  it('refuses to merge the configured branch into a different checked-out branch', async () => {
    const { work, service } = await fixture()
    git(work, 'checkout', '-b', 'other/work')
    const before = git(work, 'rev-parse', 'HEAD')
    await expect(service.pullConfiguredTarget({ remoteName: 'origin', branchName: 'main' }))
      .rejects.toMatchObject({ code: 'BRANCH_MISMATCH' })
    expect(git(work, 'branch', '--show-current')).toBe('other/work')
    expect(git(work, 'rev-parse', 'HEAD')).toBe(before)
  })

  it('previews the latest remote commit and explicitly merges when pull.rebase is configured', async () => {
    const { work, directory, remote, service } = await fixture()
    const teammate = join(directory, 'teammate')
    git(directory, 'clone', remote, teammate)
    git(teammate, 'config', 'user.name', 'Teammate')
    git(teammate, 'config', 'user.email', 'teammate@example.test')
    git(teammate, 'config', 'commit.gpgsign', 'false')
    await writeFile(join(teammate, 'incoming.txt'), 'team update\n')
    git(teammate, 'add', '.')
    git(teammate, 'commit', '-m', 'Team update')
    git(teammate, 'push')
    const incoming = git(teammate, 'rev-parse', 'HEAD')
    await writeFile(join(work, 'local.txt'), 'local update\n')
    git(work, 'add', '.')
    git(work, 'commit', '-m', 'Local update')
    git(work, 'config', 'pull.rebase', 'true')

    const preview = await service.previewPullUpdates({ remoteName: 'origin', branchName: 'main' })
    expect(preview.behind_count).toBe(1)
    expect(preview.latest_remote_hash).toBe(incoming)
    expect(preview.commits[0].message).toBe('Team update')
    await service.pullConfiguredTarget({ remoteName: 'origin', branchName: 'main' })
    expect(git(work, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
  })

  it('preserves unmerged work even if it was pushed to its own upstream', async () => {
    const { work, remote, service } = await fixture()
    git(work, 'checkout', '-b', 'feature/unmerged')
    await writeFile(join(work, 'valuable.txt'), 'unique saved work\n')
    git(work, 'add', '.')
    git(work, 'commit', '-m', 'Unmerged work')
    git(work, 'push', '-u', 'origin', 'feature/unmerged')
    const saved = git(work, 'rev-parse', 'HEAD')
    git(work, 'checkout', 'main')

    await expect(service.deleteBranch('feature/unmerged', { remoteName: 'origin', deleteRemote: true }))
      .rejects.toMatchObject({ code: 'BRANCH_NOT_MERGED' })
    expect(git(work, 'rev-parse', 'refs/heads/feature/unmerged')).toBe(saved)
    expect(git(remote, 'rev-parse', 'refs/heads/feature/unmerged')).toBe(saved)
  })

  it('preserves unmerged teammate work on a locally merged remote branch', async () => {
    const { work, remote, service } = await fixture()
    git(work, 'checkout', '-b', 'feature/teammate')
    await writeFile(join(work, 'remote-only.txt'), 'teammate work\n')
    git(work, 'add', '.')
    git(work, 'commit', '-m', 'Remote-only work')
    git(work, 'push', '-u', 'origin', 'feature/teammate')
    const remoteTip = git(work, 'rev-parse', 'HEAD')
    git(work, 'checkout', 'main')
    git(work, 'branch', '-f', 'feature/teammate', 'main')

    await expect(service.deleteBranch('feature/teammate', { remoteName: 'origin', deleteRemote: true }))
      .rejects.toMatchObject({ code: 'BRANCH_NOT_MERGED' })
    expect(git(remote, 'rev-parse', 'refs/heads/feature/teammate')).toBe(remoteTip)
    expect(git(work, 'rev-parse', 'refs/heads/feature/teammate')).toBe(git(work, 'rev-parse', 'main'))
  })

  it('deletes a merged remote branch only if no teammate updates it after verification', async () => {
    const { work, remote } = await fixture()
    git(work, 'branch', 'feature/race')
    git(work, 'push', '-u', 'origin', 'feature/race')
    git(work, 'checkout', '-b', 'race-update')
    await writeFile(join(work, 'racing.txt'), 'concurrent work\n')
    git(work, 'add', '.')
    git(work, 'commit', '-m', 'Concurrent work')
    git(work, 'push', 'origin', 'race-update')
    const concurrentHash = git(work, 'rev-parse', 'HEAD')
    git(work, 'checkout', 'main')
    const client = simpleGit(work)
    const originalRaw = client.raw.bind(client)
    client.raw = ((args: string[]) => {
      if (args.includes('--delete')) git(remote, 'update-ref', 'refs/heads/feature/race', concurrentHash)
      return originalRaw(args)
    }) as typeof client.raw

    const result = await new GitService(work, client).deleteBranch('feature/race', { remoteName: 'origin', deleteRemote: true })
    expect(result.local_deleted).toBe(true)
    expect(result.remote_deleted).toBe(false)
    expect(result.remote_delete_error).toBeTruthy()
    expect(git(remote, 'rev-parse', 'refs/heads/feature/race')).toBe(concurrentHash)
  })

  it('deletes a fully merged branch locally and remotely with a verified lease', async () => {
    const { work, remote, service } = await fixture()
    git(work, 'branch', 'feature/merged')
    git(work, 'push', '-u', 'origin', 'feature/merged')
    const result = await service.deleteBranch('feature/merged', { remoteName: 'origin', deleteRemote: true })
    expect(result.local_deleted).toBe(true)
    expect(result.remote_deleted).toBe(true)
    expect(git(work, 'branch', '--list', 'feature/merged')).toBe('')
    expect(git(remote, 'for-each-ref', 'refs/heads/feature/merged')).toBe('')
  })

  it('cleans up a merged local branch after GitHub has already removed its remote branch', async () => {
    const { work, remote } = await fixture()
    git(work, 'branch', 'feature/already-merged')
    git(work, 'push', '-u', 'origin', 'feature/already-merged')
    git(work, 'push', 'origin', '--delete', 'feature/already-merged')
    const client = simpleGit(work)
    const raw = vi.spyOn(client, 'raw')

    const result = await new GitService(work, client).deleteBranch('feature/already-merged', {
      remoteName: 'origin', deleteRemote: true
    })
    expect(result.local_deleted).toBe(true)
    expect(result.remote_delete_error).toBeNull()
    expect(git(work, 'branch', '--list', 'feature/already-merged')).toBe('')
    expect(git(remote, 'for-each-ref', 'refs/heads/feature/already-merged')).toBe('')
    expect(raw.mock.calls.some(([args]) => Array.isArray(args) && args.includes('--delete'))).toBe(false)
  })

  it('removes extra destinations from the VIVA-managed backup remote', async () => {
    const { directory, remote, work, service } = await fixture()
    const unintended = join(directory, 'unintended.git')
    git(directory, 'init', '--bare', '--initial-branch=main', unintended)
    const expectedUrl = 'https://github.com/team/backup.git'
    git(work, 'config', `url.${pathToFileURL(remote).href}.insteadOf`, expectedUrl)
    git(work, 'remote', 'add', 'gat-backup', expectedUrl)
    git(work, 'config', '--add', 'remote.gat-backup.pushurl', expectedUrl)
    git(work, 'config', '--add', 'remote.gat-backup.pushurl', unintended)

    await service.pushConfiguredTarget({ mode: 'backup', remoteName: 'gat-backup', repoOwner: 'team', repoName: 'backup', token: 'test-token' })
    expect(git(work, 'config', '--get-all', 'remote.gat-backup.pushurl')).toBe(expectedUrl)
    expect(git(unintended, 'for-each-ref')).toBe('')
  })
})
