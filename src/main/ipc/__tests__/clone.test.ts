import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloneDependencies } from '../../projectSetup/cloneRepository'
import { registerCloneHandlers } from '../clone'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), clone: vi.fn(), token: vi.fn(), register: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../db/credentials', () => ({ getGithubToken: mocks.token }))
vi.mock('../../projectSetup/cloneRepository', () => ({ cloneRepository: mocks.clone }))
vi.mock('../projects', () => ({ registerProjectForUse: mocks.register }))

const input = { jobId: 'clone-job-1234', repositoryUrl: 'https://github.com/team/demo', parentPath: '/projects', directoryName: 'demo' }
let handlers: Map<string, (...args: any[]) => any>
function sender(id: number) {
  return Object.assign(new EventEmitter(), { id, send: vi.fn(), isDestroyed: vi.fn(() => false) })
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.token.mockReturnValue(null)
  handlers = new Map()
  mocks.handle.mockImplementation((channel, handler) => handlers.set(channel, handler))
  registerCloneHandlers()
})
describe('clone IPC ownership', () => {
  it('supports public cloning without login and confines progress to the owning renderer', async () => {
    const owner = sender(1)
    mocks.clone.mockImplementation(async (_input, dependencies: CloneDependencies) => {
      expect(dependencies.token).toBeNull()
      expect(dependencies.registerProject).toBe(mocks.register)
      dependencies.onProgress?.({ jobId: input.jobId, phase: 'receiving', percent: 20 })
      return { ok: false, code: 'network' }
    })
    expect(await handlers.get('project-setup:clone')!({ sender: owner }, input)).toEqual({ ok: false, code: 'network' })
    expect(owner.send).toHaveBeenCalledWith('project-setup:clone-progress', { jobId: input.jobId, phase: 'receiving', percent: 20 })
    expect(owner.listenerCount('destroyed')).toBe(0)
  })
  it('uses a stored token only in the main process dependencies', async () => {
    mocks.token.mockReturnValue('private-token')
    mocks.clone.mockResolvedValue({ ok: false, code: 'authentication' })
    const result = await handlers.get('project-setup:clone')!({ sender: sender(1) }, input)
    expect(mocks.clone.mock.calls[0][1].token).toBe('private-token')
    expect(JSON.stringify(result)).not.toContain('private-token')
  })
  it('lets only the owner cancel and blocks duplicate in-flight jobs', async () => {
    let finish!: (value: unknown) => void
    mocks.clone.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const owner = sender(1)
    const pending = handlers.get('project-setup:clone')!({ sender: owner }, input)
    const dependencies = mocks.clone.mock.calls[0][1] as CloneDependencies
    expect(await handlers.get('project-setup:clone')!({ sender: owner }, { ...input, jobId: 'clone-job-5678' })).toEqual({ ok: false, code: 'busy' })
    expect(handlers.get('project-setup:clone-cancel')!({ sender: sender(2) }, input.jobId)).toBe(false)
    expect(dependencies.signal.aborted).toBe(false)
    expect(handlers.get('project-setup:clone-cancel')!({ sender: owner }, input.jobId)).toBe(true)
    expect(dependencies.signal.aborted).toBe(true)
    finish({ ok: false, code: 'cancelled' })
    await pending
    expect(handlers.get('project-setup:clone-cancel')!({ sender: owner }, input.jobId)).toBe(false)
  })
  it('aborts when the owner window is destroyed', async () => {
    let finish!: (value: unknown) => void
    mocks.clone.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const owner = sender(1)
    const pending = handlers.get('project-setup:clone')!({ sender: owner }, input)
    owner.emit('destroyed')
    expect(mocks.clone.mock.calls[0][1].signal.aborted).toBe(true)
    finish({ ok: false, code: 'cancelled' })
    await pending
  })
})
