// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloneProject } from '../hooks/useCloneProject'
import { invokeDb } from '../ipc'
import { CloneProgress, CloneResult } from '../../../shared/clone'

const mock = vi.hoisted(() => ({ dispatch: vi.fn(), language: 'en' as 'en' | 'ko' }))
vi.mock('../context/AppContext', () => ({ useAppContext: () => ({
  state: { preferences: { language: mock.language }, projects: [] }, dispatch: mock.dispatch
}) }))
vi.mock('../ipc', () => ({ invokeDb: vi.fn() }))

let progressListener: (_event: unknown, progress: CloneProgress) => void
const unsubscribe = vi.fn()
const project = { project_id: 'cloned-project', local_path: '/projects/demo', friendly_name: 'demo', last_accessed: 1 }
beforeEach(() => {
  vi.clearAllMocks()
  mock.language = 'en'
  Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: {
    on: vi.fn((_channel, listener) => { progressListener = listener; return unsubscribe }), removeAllListeners: vi.fn()
  } } })
  vi.mocked(invokeDb).mockImplementation(async (channel) => {
    if (channel === 'dialog:openFolder') return '/projects'
    if (channel === 'project-setup:clone') return { ok: true, project }
    if (channel === 'db:projects:list') return [project]
    if (channel === 'project-setup:clone-cancel') return true
    throw new Error('Unexpected channel: ' + channel)
  })
})
afterEach(() => { cleanup() })

async function prepare(result: { current: ReturnType<typeof useCloneProject> }) {
  act(() => { result.current.open(); result.current.setRepositoryUrl('https://github.com/team/demo') })
  await act(async () => { await result.current.chooseParent() })
}

describe('useCloneProject', () => {
  it('chooses a parent and opens the successfully registered project', async () => {
    const onCloned = vi.fn()
    const { result } = renderHook(() => useCloneProject({ onCloned }))
    await prepare(result)
    expect(result.current.directoryName).toBe('demo')
    await act(async () => { await result.current.submit() })
    expect(invokeDb).toHaveBeenCalledWith('project-setup:clone', expect.objectContaining({
      repositoryUrl: 'https://github.com/team/demo', directoryName: 'demo', parentPath: '/projects'
    }))
    expect(mock.dispatch).toHaveBeenCalledWith({ type: 'SET_PROJECTS', projects: [project] })
    expect(mock.dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_PROJECT', project_id: project.project_id })
    expect(onCloned).toHaveBeenCalledWith(project)
    expect(result.current.isOpen).toBe(false)
  })
  it('validates URL and folder names before invoking clone', async () => {
    const { result } = renderHook(() => useCloneProject())
    await prepare(result)
    act(() => { result.current.setRepositoryUrl('file:///etc'); result.current.setDirectoryName('../outside') })
    await act(async () => { await result.current.submit() })
    expect(result.current.error).toContain('GitHub HTTPS')
    act(() => { result.current.setRepositoryUrl('https://github.com/team/demo') })
    await act(async () => { await result.current.submit() })
    expect(result.current.error).toContain('new folder name')
    expect(vi.mocked(invokeDb).mock.calls.filter(([channel]) => channel === 'project-setup:clone')).toHaveLength(0)
  })
  it('keeps actionable errors localized and never selects a failed clone', async () => {
    mock.language = 'ko'
    vi.mocked(invokeDb).mockImplementation(async (channel) => channel === 'dialog:openFolder' ? '/projects' : { ok: false, code: 'authentication' })
    const { result } = renderHook(() => useCloneProject())
    await prepare(result)
    await act(async () => { await result.current.submit() })
    expect(result.current.error).toContain('비공개 저장소')
    expect(result.current.isOpen).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(mock.dispatch).not.toHaveBeenCalled()
  })
  it('scopes progress to the active job and waits for cancellation cleanup', async () => {
    let resolveClone!: (result: CloneResult) => void
    vi.mocked(invokeDb).mockImplementation(async (channel) => {
      if (channel === 'dialog:openFolder') return '/projects'
      if (channel === 'project-setup:clone') return new Promise<CloneResult>((resolve) => { resolveClone = resolve })
      return true
    })
    const { result } = renderHook(() => useCloneProject())
    await prepare(result)
    let submitted!: Promise<void>
    act(() => { submitted = result.current.submit() })
    const call = vi.mocked(invokeDb).mock.calls.find(([channel]) => channel === 'project-setup:clone')!
    const jobId = (call[1] as { jobId: string }).jobId
    act(() => { progressListener(null, { jobId: 'other-job', phase: 'receiving', percent: 80 }) })
    expect(result.current.progress).toBeNull()
    act(() => { progressListener(null, { jobId, phase: 'receiving', percent: 40 }) })
    expect(result.current.progress?.percent).toBe(40)
    act(() => { result.current.close() })
    expect(result.current.isOpen).toBe(true)
    await act(async () => { await result.current.cancel() })
    expect(invokeDb).toHaveBeenCalledWith('project-setup:clone-cancel', jobId)
    expect(result.current.loading).toBe(true)
    expect(result.current.cancelling).toBe(true)
    await act(async () => { resolveClone({ ok: false, code: 'cancelled' }); await submitted })
    expect(result.current.loading).toBe(false)
    expect(result.current.cancelling).toBe(false)
    expect(result.current.error).toContain('cancelled')
    expect(mock.dispatch).not.toHaveBeenCalled()
  })
  it('cancels an in-flight clone when unmounted and removes only its event subscription', async () => {
    vi.mocked(invokeDb).mockImplementation(async (channel) => {
      if (channel === 'dialog:openFolder') return '/projects'
      if (channel === 'project-setup:clone') return new Promise(() => {})
      return true
    })
    const { result, unmount } = renderHook(() => useCloneProject())
    await prepare(result)
    act(() => { void result.current.submit() })
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(invokeDb).toHaveBeenCalledWith('project-setup:clone-cancel', expect.any(String))
  })
  it('preserves the completed folder path when registration needs recovery', async () => {
    vi.mocked(invokeDb).mockImplementation(async (channel) => channel === 'dialog:openFolder' ? '/projects' : { ok: false, code: 'registration', localPath: '/projects/demo' })
    const { result } = renderHook(() => useCloneProject())
    await prepare(result)
    await act(async () => { await result.current.submit() })
    expect(result.current.recoveryPath).toBe('/projects/demo')
    expect(result.current.error).toContain('Link the folder')
  })
})
