import { describe, expect, it, vi } from 'vitest'
import { GitService } from '../service'
import { mapGitError } from '../errors'

function makeGit(current = 'feature/work') {
  return {
    status: vi.fn().mockResolvedValue({ current }),
    branchLocal: vi.fn().mockResolvedValue({ all: ['main', 'feature/work'] }),
    checkoutLocalBranch: vi.fn(),
    getRemotes: vi.fn().mockResolvedValue([{
      name: 'origin', refs: { fetch: 'https://github.com/team/project.git', push: 'https://github.com/team/project.git' }
    }]),
    raw: vi.fn().mockResolvedValue('ref: refs/heads/main\tHEAD\n'),
    push: vi.fn(),
    pull: vi.fn()
  }
}

describe('collaboration branch safety', () => {
  it('reuses an already-created current branch when retrying new branch upload', async () => {
    const git = makeGit()
    const service = new GitService('/tmp/project', git as never)
    await service.pushConfiguredTarget({
      mode: 'collaboration', remoteName: 'origin', branchMode: 'new_branch', branchName: 'feature/work'
    })
    expect(git.checkoutLocalBranch).not.toHaveBeenCalled()
    expect(git.push).toHaveBeenCalledWith('origin', 'feature/work', ['-u'])
  })

  it.each(['existing_branch', 'new_branch'] as const)('refuses stale %s upload', async (branchMode) => {
    const git = makeGit('other/work')
    await expect(new GitService('/tmp/project', git as never).pushConfiguredTarget({
      mode: 'collaboration', remoteName: 'origin', branchMode, branchName: 'feature/work'
    })).rejects.toMatchObject({ code: 'BRANCH_MISMATCH' })
    expect(git.push).not.toHaveBeenCalled()
  })

  it('protects the actual remote default branch despite an existing-branch mode', async () => {
    const git = makeGit('release')
    git.raw.mockResolvedValue('ref: refs/heads/release\tHEAD\n')
    await expect(new GitService('/tmp/project', git as never).pushConfiguredTarget({
      mode: 'collaboration', remoteName: 'origin', branchMode: 'existing_branch', branchName: 'release'
    })).rejects.toMatchObject({ code: 'DEFAULT_BRANCH_PROTECTED' })
    expect(git.push).not.toHaveBeenCalled()
  })

  it('refuses pull and preview when another branch is checked out', async () => {
    const git = makeGit('other/work')
    const service = new GitService('/tmp/project', git as never)
    const input = { remoteName: 'origin', branchName: 'feature/work' }
    await expect(service.pullConfiguredTarget(input)).rejects.toMatchObject({ code: 'BRANCH_MISMATCH' })
    await expect(service.previewPullUpdates(input)).rejects.toMatchObject({ code: 'BRANCH_MISMATCH' })
    expect(git.pull).not.toHaveBeenCalled()
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('does not publish a newly created local branch onto the remote default branch', async () => {
    const git = makeGit('main')
    git.raw.mockResolvedValue('ref: refs/heads/release\tHEAD\n')
    const result = await new GitService('/tmp/project', git as never).createBranch('release', {
      remoteName: 'origin', publishRemote: true
    })
    expect(result.published).toBe(false)
    expect(result.publish_error).toContain('danger-mode')
    expect(git.push).not.toHaveBeenCalled()
  })

  it('fails closed when the remote default cannot be verified', async () => {
    const git = makeGit()
    git.raw.mockRejectedValue(new Error('Network unavailable'))
    await expect(new GitService('/tmp/project', git as never).pushConfiguredTarget({
      mode: 'collaboration', remoteName: 'origin', branchMode: 'existing_branch', branchName: 'feature/work'
    })).rejects.toMatchObject({ code: 'DEFAULT_BRANCH_PROTECTED' })
    expect(git.push).not.toHaveBeenCalled()
  })

  it('checks both live remote URLs against the repository approved during setup', async () => {
    const git = makeGit()
    git.getRemotes.mockResolvedValue([{
      name: 'origin', refs: { fetch: 'https://github.com/team/project.git', push: 'https://github.com/other/project.git' }
    }])
    await expect(new GitService('/tmp/project', git as never).pushConfiguredTarget({
      mode: 'collaboration', remoteName: 'origin', branchMode: 'existing_branch', branchName: 'feature/work',
      repoOwner: 'team', repoName: 'project', token: 'test-token'
    })).rejects.toMatchObject({ code: 'NO_REMOTE' })
    expect(git.raw).not.toHaveBeenCalled()
    expect(git.push).not.toHaveBeenCalled()
  })

  it('fetches into the named tracking ref with temporary authentication', async () => {
    const git = makeGit()
    git.raw.mockImplementation(async (args) => args.includes('rev-list') ? '0' : '')
    const service = new GitService('/tmp/project', { ...git, revparse: vi.fn().mockResolvedValue('abc') } as never)
    await service.previewPullUpdates({ remoteName: 'origin', branchName: 'feature/work', token: 'test-token' })
    expect(git.raw).toHaveBeenCalledWith([
      '-c', expect.stringContaining('AUTHORIZATION: basic '),
      'fetch', 'origin', '+refs/heads/feature/work:refs/remotes/origin/feature/work'
    ])
  })

  it('rejects an additional push URL even when the remote summary looks correct', async () => {
    const git = makeGit()
    git.raw.mockImplementation(async (args) => args.includes('--push')
      ? 'https://github.com/team/project.git\nhttps://github.com/another/destination.git\n'
      : 'https://github.com/team/project.git\n')
    await expect(new GitService('/tmp/project', git as never)
      .validateCollaborationRemote('origin', 'team', 'project')).rejects.toMatchObject({ code: 'NO_REMOTE' })
  })

  it('removes credentials from git failures before they cross IPC', () => {
    const error = mapGitError(new Error('https://oauth2:secret@github.com/org/repo AUTHORIZATION: basic c2VjcmV0 github_pat_example'))
    expect(error.raw).not.toContain('secret')
    expect(error.raw).not.toContain('c2VjcmV0')
    expect(error.raw).not.toContain('github_pat_example')
  })
})
