import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  token: vi.fn(), target: vi.fn(), validateRemote: vi.fn(), remotes: vi.fn(), snapshot: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) }
}))
vi.mock('../../db/credentials', () => ({ getGithubToken: mocks.token }))
vi.mock('../../db/projectCloudTargets', () => ({ getProjectCloudTarget: mocks.target }))
vi.mock('../../git', () => ({ getGitService: () => ({ validateCollaborationRemote: mocks.validateRemote, getRemotes: mocks.remotes }) }))
vi.mock('../../github/dashboardService', async (importActual) => ({
  ...await importActual<typeof import('../../github/dashboardService')>(),
  createDashboardService: () => ({ getSnapshot: mocks.snapshot })
}))

import { registerDashboardHandlers } from '../dashboard'

const target = {
  mode: 'collaboration', backup: null,
  collaboration: { remoteName: 'origin', repoOwner: 'team', repoName: 'project', selectedBranch: 'work', branchMode: 'existing_branch' }
}
const call = (...args: unknown[]): Promise<unknown> => mocks.handlers.get('dashboard:get')!(undefined, ...args)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.token.mockReturnValue('secret-token')
  mocks.target.mockReturnValue(target)
  mocks.validateRemote.mockResolvedValue(undefined)
  mocks.remotes.mockResolvedValue([{ name: 'origin', fetch: 'https://github.com/team/project.git', push: 'git@github.com:team/project.git' }])
  mocks.snapshot.mockResolvedValue({ viewerLogin: 'lead', warnings: [] })
  registerDashboardHandlers()
})

describe('dashboard IPC boundary', () => {
  it('uses only the configured identity and verifies the local remote before fetching', async () => {
    const snapshot = await call('project-id', true)
    expect(mocks.validateRemote).toHaveBeenCalledWith('origin', 'team', 'project')
    expect(mocks.snapshot).toHaveBeenCalledWith({ token: 'secret-token', owner: 'team', repo: 'project' })
    expect(mocks.validateRemote.mock.invocationCallOrder[0]).toBeLessThan(mocks.snapshot.mock.invocationCallOrder[0])
    expect(snapshot).toEqual({ viewerLogin: 'lead', warnings: [] })
  })

  it('rejects absent configuration without an eligible origin and missing sign-in with actionable errors', async () => {
    mocks.target.mockReturnValue({ mode: 'none' })
    mocks.remotes.mockResolvedValue([])
    await expect(call('project-id')).rejects.toThrow('[SETUP_REQUIRED]')
    mocks.target.mockReturnValue(target)
    mocks.token.mockReturnValue(null)
    await expect(call('project-id')).rejects.toThrow('[NOT_CONNECTED] Connect GitHub')
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('uses a verified GitHub origin for a cloned read-only repository without configuring uploads', async () => {
    mocks.target.mockReturnValue({ mode: 'none', collaboration: null, backup: null })
    expect(await call('project-id')).toEqual({ viewerLogin: 'lead', warnings: [] })
    expect(mocks.validateRemote).toHaveBeenCalledTimes(2)
    expect(mocks.validateRemote).toHaveBeenCalledWith('origin', 'team', 'project')
    expect(mocks.snapshot).toHaveBeenCalledWith({ token: 'secret-token', owner: 'team', repo: 'project' })
    expect(mocks.validateRemote.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.snapshot.mock.invocationCallOrder[0])
  })

  it.each([
    [{ name: 'origin', fetch: 'https://github.com/team/project.git', push: 'https://github.com/other/project.git' }],
    [{ name: 'upstream', fetch: 'https://github.com/team/project.git', push: 'https://github.com/team/project.git' }],
    [{ name: 'origin', fetch: 'https://example.com/team/project.git', push: 'https://example.com/team/project.git' }],
    [
      { name: 'origin', fetch: 'https://github.com/team/project.git', push: 'https://github.com/team/project.git' },
      { name: 'origin', fetch: 'https://github.com/other/project.git', push: 'https://github.com/other/project.git' }
    ]
  ])('blocks ambiguous or ineligible origin configuration %#', async (...remotes) => {
    mocks.target.mockReturnValue({ mode: 'none' })
    mocks.remotes.mockResolvedValue(remotes)
    await expect(call('project-id')).rejects.toThrow('[SETUP_REQUIRED]')
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('checks all configured origin URL aliases before querying GitHub', async () => {
    mocks.target.mockReturnValue({ mode: 'none' })
    mocks.validateRemote.mockRejectedValueOnce({ message: 'Another URL alias targets a different repository.' })
    await expect(call('project-id')).rejects.toThrow('[SETUP_REQUIRED]')
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('blocks an origin changed during loading before delivering the response', async () => {
    mocks.target.mockReturnValue({ mode: 'none' })
    mocks.validateRemote.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ message: 'Origin changed.' })
    await expect(call('project-id')).rejects.toThrow('[SETUP_REQUIRED] The GitHub origin changed while loading')
    expect(mocks.snapshot).toHaveBeenCalledOnce()
  })

  it('rejects switched, missing or multiple-identity remotes without contacting GitHub', async () => {
    mocks.validateRemote.mockRejectedValue({ code: 'NO_REMOTE', message: 'details secret-token' })
    await expect(call('project-id')).rejects.toThrow('repository remote changed')
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })

  it('does not deliver data from an account disconnected during the request', async () => {
    mocks.snapshot.mockImplementation(async () => { mocks.token.mockReturnValue(null); return { private: true } })
    await expect(call('project-id')).rejects.toThrow('[TARGET_CHANGED] GitHub account or upload target changed')
  })

  it('does not deliver data from a target changed during the request', async () => {
    mocks.snapshot.mockImplementation(async () => { mocks.target.mockReturnValue({ mode: 'none' }); return { private: true } })
    await expect(call('project-id')).rejects.toThrow('[TARGET_CHANGED] GitHub account or upload target changed')
  })

  it('sanitizes unexpected errors so credentials never cross IPC', async () => {
    mocks.snapshot.mockRejectedValue(new Error('secret-token private response'))
    await expect(call('project-id')).rejects.toThrow('[NETWORK] Could not load the GitHub dashboard')
  })

  it.each([[null], ['project-id', 'https://evil.example']])('validates IPC arguments', async (...args) => {
    await expect(call(...args)).rejects.toThrow('[SETUP_REQUIRED] Choose a project')
    expect(mocks.snapshot).not.toHaveBeenCalled()
  })
})
