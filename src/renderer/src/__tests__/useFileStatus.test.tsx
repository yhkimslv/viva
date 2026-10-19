// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileStatus } from '../hooks/useFileStatus'
import { GitStatus } from '../types'

const { invokeGit } = vi.hoisted(() => ({ invokeGit: vi.fn() }))
vi.mock('../ipc', () => ({ invokeGit }))

function status(branch: string): GitStatus {
  return {
    current_branch: branch, files: [], tracked_files: [`${branch}.ts`],
    ahead: 0, behind: 0, has_conflicts: false, is_clean: true
  }
}

describe('useFileStatus project isolation', () => {
  beforeEach(() => {
    invokeGit.mockReset()
    Object.defineProperty(window, 'electron', { configurable: true, value: {
      ipcRenderer: { on: vi.fn(), removeAllListeners: vi.fn() }
    } })
  })

  it('hides old project files while the next project loads', async () => {
    invokeGit.mockResolvedValueOnce(status('first')).mockReturnValueOnce(new Promise(() => {}))
    const { result, rerender } = renderHook(({ projectId }) => useFileStatus(projectId), {
      initialProps: { projectId: 'first' }
    })
    await act(async () => {})
    expect(result.current.status?.current_branch).toBe('first')

    rerender({ projectId: 'second' })

    expect(result.current.status).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('ignores the previous project response when it arrives last', async () => {
    let finishFirst!: (value: GitStatus) => void
    invokeGit.mockReturnValueOnce(new Promise<GitStatus>((resolve) => { finishFirst = resolve }))
      .mockResolvedValueOnce(status('second'))
    const { result, rerender } = renderHook(({ projectId }) => useFileStatus(projectId), {
      initialProps: { projectId: 'first' }
    })
    rerender({ projectId: 'second' })
    await act(async () => {})
    await act(async () => { finishFirst(status('first')) })

    expect(result.current.status?.current_branch).toBe('second')
    expect(result.current.error).toBeNull()
  })

  it('keeps the latest status when overlapping refreshes finish out of order', async () => {
    let finishOld!: (value: GitStatus) => void
    invokeGit.mockReturnValueOnce(new Promise<GitStatus>((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce(status('latest'))
    const { result } = renderHook(() => useFileStatus('project-1'))
    await act(async () => { await result.current.fetchStatus() })
    await act(async () => { finishOld(status('stale')) })

    expect(result.current.status?.current_branch).toBe('latest')
  })
})
