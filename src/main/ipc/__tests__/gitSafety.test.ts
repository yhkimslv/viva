import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectCloudTarget } from '../../db/projectCloudTargets'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  state: { target: { mode: 'none', backup: null, collaboration: null } as ProjectCloudTarget },
  service: {
    pushConfiguredTarget: vi.fn(), pullConfiguredTarget: vi.fn(), previewPullUpdates: vi.fn(),
    createBranch: vi.fn(), switchBranch: vi.fn(), deleteBranch: vi.fn(), getDefaultBranch: vi.fn(),
    resolveConflict: vi.fn(), validateCollaborationRemote: vi.fn(), getStatus: vi.fn(), stage: vi.fn()
  },
  validateTokenForRepository: vi.fn(),
  invalidateCache: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => mocks.handlers.set(channel, handler) } }))
vi.mock('../../git', () => ({ getGitService: () => mocks.service, removeGitService: vi.fn() }))
vi.mock('../../db/projectCloudTargets', () => ({
  getProjectCloudTarget: () => mocks.state.target,
  setProjectCloudTarget: (_project: string, target: ProjectCloudTarget) => { mocks.state.target = target }
}))
vi.mock('../../db/credentials', () => ({ getGithubToken: () => 'test-token' }))
vi.mock('../../db/aiSummaries', () => ({ addAiCommitSummary: vi.fn() }))
vi.mock('../../db/statusCache', () => ({ getCachedStatus: vi.fn(), setCachedStatus: vi.fn(), invalidateCache: mocks.invalidateCache }))
vi.mock('../../github/service', () => ({ createGithubService: () => ({ validateTokenForRepository: mocks.validateTokenForRepository }) }))

import { registerGitHandlers } from '../git'
import { registerCloudHandlers } from '../cloud'

function collaboration(branchMode: 'new_branch' | 'existing_branch' = 'new_branch'): ProjectCloudTarget {
  return {
    mode: 'collaboration', backup: null,
    collaboration: { remoteName: 'origin', repoOwner: 'team', repoName: 'project', selectedBranch: 'feature/work', branchMode }
  }
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return mocks.handlers.get(channel)!(undefined, 'project-1', ...args)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.handlers.clear()
  mocks.state.target = { mode: 'none', backup: null, collaboration: null }
  mocks.service.getDefaultBranch.mockResolvedValue('main')
  mocks.validateTokenForRepository.mockResolvedValue({ status: 'ok' })
  registerGitHandlers()
  registerCloudHandlers()
})

describe('git IPC collaboration safety', () => {
  it('promotes a new upload target to existing only after a successful upload', async () => {
    mocks.state.target = collaboration()
    mocks.service.pushConfiguredTarget.mockResolvedValue({ remoteName: 'origin', branchName: 'feature/work', prUrl: 'https://github.com/team/project/compare/feature%2Fwork' })
    await invoke('git:push')
    expect(mocks.state.target.collaboration?.branchMode).toBe('existing_branch')
    expect(mocks.service.pushConfiguredTarget).toHaveBeenCalledWith(expect.objectContaining({ repoOwner: 'team', repoName: 'project' }))
  })

  it('keeps new mode available for retry when publishing fails', async () => {
    mocks.state.target = collaboration()
    mocks.service.pushConfiguredTarget.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Offline' })
    expect(await invoke('git:push')).toEqual({ error: { code: 'NETWORK_ERROR', message: 'Offline' } })
    expect(mocks.state.target.collaboration?.branchMode).toBe('new_branch')
  })

  it('requires old targets to be reselected before trusting their repository identity', async () => {
    mocks.state.target = collaboration()
    delete mocks.state.target.collaboration!.repoOwner
    expect(await invoke('git:push')).toMatchObject({ error: { code: 'NO_REMOTE' } })
    expect(await invoke('git:pull')).toMatchObject({ error: { code: 'NO_REMOTE' } })
    expect(mocks.service.pushConfiguredTarget).not.toHaveBeenCalled()
    expect(mocks.service.pullConfiguredTarget).not.toHaveBeenCalled()
  })

  it('does not publish a new branch to an unselected origin', async () => {
    mocks.service.createBranch.mockResolvedValue({ name: 'feature/local', published: false })
    await invoke('git:branch:create', 'feature/local')
    expect(mocks.service.createBranch).toHaveBeenCalledWith('feature/local', expect.objectContaining({ publishRemote: false }))
  })

  it('switches upload mode to danger mode when selecting the real default branch', async () => {
    mocks.state.target = collaboration('existing_branch')
    mocks.service.switchBranch.mockResolvedValue(undefined)
    mocks.service.getDefaultBranch.mockResolvedValue('release')
    await invoke('git:branch:switch', 'release')
    expect(mocks.state.target.collaboration).toMatchObject({ selectedBranch: 'release', branchMode: 'danger_default_branch' })
  })

  it('invalidates status again after conflict resolution finishes', async () => {
    let finish!: () => void
    mocks.service.resolveConflict.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const operation = invoke('git:conflict:resolve', 'notes.txt', 'ours')
    await vi.waitFor(() => expect(mocks.service.resolveConflict).toHaveBeenCalled())
    const invalidationsBeforeFinish = mocks.invalidateCache.mock.calls.length
    finish()
    await operation
    expect(mocks.invalidateCache).toHaveBeenCalledWith('project-1')
    expect(mocks.invalidateCache.mock.calls.length).toBeGreaterThan(invalidationsBeforeFinish)
  })

  it('stores verified repository identity when selecting a team target', async () => {
    const input = { remoteName: 'origin', repoOwner: 'team', repoName: 'project', selectedBranch: 'feature/work', branchMode: 'new_branch' }
    await invoke('cloud:collaboration:set', input)
    expect(mocks.service.validateCollaborationRemote).toHaveBeenCalledWith('origin', 'team', 'project')
    expect(mocks.state.target.collaboration).toMatchObject({ repoOwner: 'team', repoName: 'project' })
  })

  it('refuses remote changes before calling the repository permission check', async () => {
    mocks.service.validateCollaborationRemote.mockRejectedValue({ code: 'NO_REMOTE', message: 'Remote changed' })
    await expect(invoke('cloud:collaboration:set', {
      remoteName: 'origin', repoOwner: 'team', repoName: 'project', selectedBranch: 'feature/work', branchMode: 'new_branch'
    })).rejects.toMatchObject({ code: 'NO_REMOTE' })
    expect(mocks.validateTokenForRepository).not.toHaveBeenCalled()
  })

  it('finishes an update before switching branches or reading status', async () => {
    mocks.state.target = collaboration('existing_branch')
    let finishPull!: () => void
    mocks.service.pullConfiguredTarget.mockReturnValue(new Promise<void>((resolve) => { finishPull = resolve }))
    mocks.service.getStatus.mockResolvedValue({ current_branch: 'other/work' })
    const pull = invoke('git:pull')
    const switching = invoke('git:branch:switch', 'other/work')
    const status = invoke('git:status')
    await vi.waitFor(() => expect(mocks.service.pullConfiguredTarget).toHaveBeenCalled())
    expect(mocks.service.switchBranch).not.toHaveBeenCalled()
    expect(mocks.service.getStatus).not.toHaveBeenCalled()

    finishPull()
    await Promise.all([pull, switching, status])
    expect(mocks.service.switchBranch).toHaveBeenCalledWith('other/work')
    expect(mocks.service.getStatus).toHaveBeenCalledTimes(1)
  })

  it('reads the upload target after a queued branch switch completes', async () => {
    mocks.state.target = collaboration('existing_branch')
    let finishSwitch!: () => void
    mocks.service.switchBranch.mockReturnValue(new Promise<void>((resolve) => { finishSwitch = resolve }))
    mocks.service.pushConfiguredTarget.mockImplementation(async (input) => ({ remoteName: input.remoteName, branchName: input.branchName, prUrl: null }))
    const switching = invoke('git:branch:switch', 'other/work')
    const uploading = invoke('git:push')
    await vi.waitFor(() => expect(mocks.service.switchBranch).toHaveBeenCalled())
    expect(mocks.service.pushConfiguredTarget).not.toHaveBeenCalled()
    finishSwitch()
    await Promise.all([switching, uploading])
    expect(mocks.service.pushConfiguredTarget).toHaveBeenCalledWith(expect.objectContaining({ branchName: 'other/work' }))
  })

  it('releases a failed operation so the next save can proceed', async () => {
    mocks.service.stage.mockRejectedValueOnce({ code: 'UNKNOWN', message: 'Could not stage' })
    const failed = invoke('git:stage', ['a.txt'])
    const next = invoke('git:stage', ['b.txt'])
    expect(await failed).toMatchObject({ error: { message: 'Could not stage' } })
    expect(await next).toHaveProperty('data')
    expect(mocks.service.stage).toHaveBeenCalledTimes(2)
  })
})
