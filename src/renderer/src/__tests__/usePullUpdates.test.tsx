// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePullUpdates } from '../hooks/usePullUpdates'
import { PullUpdatesPreview } from '../types'

function createPreview(behindCount = 1): PullUpdatesPreview {
  return {
    remote_name: 'origin',
    branch_name: 'main',
    current_branch: 'feature/demo',
    behind_count: behindCount,
    latest_remote_hash: 'abc123',
    commits: [
      {
        hash: 'abc123',
        short_hash: 'abc123',
        message: 'Update shared UI',
        author_name: 'Teammate',
        date: '2026-04-28T12:00:00.000Z'
      }
    ]
  }
}

describe('usePullUpdates', () => {
  it('opens a preview instead of pulling immediately when incoming commits exist', async () => {
    const pull = vi.fn().mockResolvedValue(undefined)
    const invokeGit = vi.fn().mockResolvedValue(createPreview())

    const { result } = renderHook(() =>
      usePullUpdates({
        activeProjectId: 'project-1',
        enabled: false,
        currentBranch: 'feature/demo',
        invokeGit,
        pull,
        refreshStatus: vi.fn()
      })
    )

    await act(async () => {
      await result.current.requestPull()
    })

    await waitFor(() => {
      expect(result.current.showDialog).toBe(true)
    })

    expect(result.current.preview?.behind_count).toBe(1)
    expect(pull).not.toHaveBeenCalled()
  })

  it('does not pull if the preview fails', async () => {
    const pull = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePullUpdates({
      activeProjectId: 'project-1', enabled: false, currentBranch: 'feature/demo',
      invokeGit: vi.fn().mockRejectedValue({ message: 'Network unavailable' }),
      pull, refreshStatus: vi.fn()
    }))

    await act(async () => { await result.current.requestPull() })

    expect(result.current.error).toBe('Network unavailable')
    expect(result.current.showDialog).toBe(false)
    expect(pull).not.toHaveBeenCalled()
  })

  it('does not pull when the preview reports no incoming commits', async () => {
    const pull = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePullUpdates({
      activeProjectId: 'project-1', enabled: false, currentBranch: 'feature/demo',
      invokeGit: vi.fn().mockResolvedValue(createPreview(0)),
      pull, refreshStatus: vi.fn()
    }))

    await act(async () => { await result.current.requestPull() })

    expect(result.current.showDialog).toBe(false)
    expect(pull).not.toHaveBeenCalled()
  })

  it.each(['project', 'branch'])('ignores a preview after switching %s', async (switchKind) => {
    let finish!: (preview: PullUpdatesPreview) => void
    const pending = new Promise<PullUpdatesPreview>((resolve) => { finish = resolve })
    const pull = vi.fn().mockResolvedValue(undefined)
    const invokeGit = vi.fn().mockReturnValue(pending)
    const refreshStatus = vi.fn()
    const { result, rerender } = renderHook(({ projectId, branch }) => usePullUpdates({
      activeProjectId: projectId, enabled: false, currentBranch: branch,
      invokeGit, pull, refreshStatus
    }), { initialProps: { projectId: 'project-1', branch: 'feature/demo' } })

    let request!: Promise<void>
    act(() => { request = result.current.requestPull() })
    rerender(switchKind === 'project'
      ? { projectId: 'project-2', branch: 'feature/demo' }
      : { projectId: 'project-1', branch: 'feature/other' })
    await act(async () => { finish(createPreview()); await request })

    expect(result.current.preview).toBeNull()
    expect(result.current.showDialog).toBe(false)
    expect(refreshStatus).not.toHaveBeenCalled()
    expect(pull).not.toHaveBeenCalled()
  })

  it('requires a visible preview and serializes repeated confirmations', async () => {
    let finish!: () => void
    const pull = vi.fn().mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    const { result } = renderHook(() => usePullUpdates({
      activeProjectId: 'project-1', enabled: false, currentBranch: 'feature/demo',
      invokeGit: vi.fn().mockResolvedValue(createPreview()), pull, refreshStatus: vi.fn()
    }))

    act(() => { result.current.confirmPull() })
    expect(pull).not.toHaveBeenCalled()
    await act(async () => { await result.current.requestPull() })
    await act(async () => {
      result.current.confirmPull()
      result.current.confirmPull()
    })

    expect(pull).toHaveBeenCalledTimes(1)
    expect(result.current.showDialog).toBe(false)
    await act(async () => { finish() })
  })
})
