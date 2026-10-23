// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRepositoryConnection } from '../hooks/useRepositoryConnection'
import type { RepositoryConnectionInspection } from '../hooks/useRepositoryConnection'
import { invokeDb } from '../ipc'
import type { Project } from '../types'

vi.mock('../ipc', () => ({ invokeDb: vi.fn() }))

const firstProject: Project = { project_id: 'one', local_path: '/first', friendly_name: 'First', last_accessed: 0 }
const secondProject: Project = { project_id: 'two', local_path: '/second', friendly_name: 'Second', last_accessed: 0 }
const localOnly: RepositoryConnectionInspection = { isGitRepo: true, remotes: [] }
const linked: RepositoryConnectionInspection = { isGitRepo: true, remotes: [{ name: 'origin', fetch: 'git@github.com:team/project.git', push: 'git@github.com:team/project.git' }] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(cleanup)

describe('useRepositoryConnection', () => {
  it('uses the lightweight read-only channel and resets when no project is selected', async () => {
    vi.mocked(invokeDb).mockResolvedValue(localOnly)
    const { result, rerender } = renderHook(({ project }: { project: Project | null }) => useRepositoryConnection(project), { initialProps: { project: firstProject as Project | null } })
    await waitFor(() => expect(result.current.inspection).toBe(localOnly))
    expect(invokeDb).toHaveBeenCalledWith('project-setup:connection', '/first')
    rerender({ project: null })
    expect(result.current.inspection).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(invokeDb).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'] as const)('ignores an old project’s late %s after switching projects', async (completion) => {
    const oldRequest = deferred<RepositoryConnectionInspection>()
    const newRequest = deferred<RepositoryConnectionInspection>()
    vi.mocked(invokeDb).mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    const { result, rerender } = renderHook(({ project }) => useRepositoryConnection(project), { initialProps: { project: firstProject } })
    const oldRefresh = result.current.refresh
    rerender({ project: secondProject })
    expect(result.current.inspection).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => { newRequest.resolve(linked) })
    await act(async () => { completion === 'resolve' ? oldRequest.resolve(localOnly) : oldRequest.reject(new Error('old failure')) })
    expect(result.current.inspection).toBe(linked)
    expect(result.current.error).toBeNull()
    await act(async () => { await oldRefresh() })
    expect(invokeDb).toHaveBeenCalledTimes(2)
  })

  it('ignores an earlier refresh of the same project and supports retry after failure', async () => {
    const oldRequest = deferred<RepositoryConnectionInspection>()
    vi.mocked(invokeDb).mockReturnValueOnce(oldRequest.promise).mockResolvedValueOnce(linked)
    const { result } = renderHook(() => useRepositoryConnection(firstProject))
    await act(async () => { await result.current.refresh() })
    await act(async () => { oldRequest.resolve(localOnly) })
    expect(result.current.inspection).toBe(linked)
    vi.mocked(invokeDb).mockRejectedValueOnce(new Error('https://secret@github.com/team/project'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.error).toBe('inspection-failed')
    expect(result.current.inspection).toBeNull()
    vi.mocked(invokeDb).mockResolvedValueOnce(localOnly)
    await act(async () => { await result.current.refresh() })
    expect(result.current.error).toBeNull()
    expect(result.current.inspection).toBe(localOnly)
  })

  it('refreshes on configuration changes and app focus, and removes its focus listener', async () => {
    vi.mocked(invokeDb).mockResolvedValue(localOnly)
    const { result, rerender, unmount } = renderHook(({ key }) => useRepositoryConnection(firstProject, key), { initialProps: { key: 'initial' } })
    await waitFor(() => expect(result.current.inspection).toBe(localOnly))
    rerender({ key: 'configured' })
    await waitFor(() => expect(invokeDb).toHaveBeenCalledTimes(2))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(invokeDb).toHaveBeenCalledTimes(3)
    unmount()
    window.dispatchEvent(new Event('focus'))
    expect(invokeDb).toHaveBeenCalledTimes(3)
  })
})
