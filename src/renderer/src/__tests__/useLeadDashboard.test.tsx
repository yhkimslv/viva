// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLeadDashboard } from '../hooks/useLeadDashboard'
import type { DashboardSnapshot } from '../../../shared/dashboard'

const { invokeDb } = vi.hoisted(() => ({ invokeDb: vi.fn() }))
vi.mock('../ipc', () => ({ invokeDb }))

const snapshot: DashboardSnapshot = {
  repository: { owner: 'team', name: 'project', url: 'https://github.com/team/project', defaultBranch: 'main' },
  viewerLogin: 'lead', fetchedAt: '2026-10-19T20:00:00Z', pullRequests: [], issues: [], recentRuns: [], warnings: []
}

describe('useLeadDashboard', () => {
  beforeEach(() => { invokeDb.mockReset() })
  afterEach(() => { vi.useRealTimers() })

  it('loads a connected project and keeps the last successful snapshot on refresh failure', async () => {
    invokeDb.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error('Rate limit reached'))
    const { result } = renderHook(() => useLeadDashboard('project-1', true, 'repo-1'))
    await act(async () => {})
    expect(result.current.snapshot).toEqual(snapshot)

    await act(async () => { await result.current.refresh() })

    expect(result.current.snapshot).toEqual(snapshot)
    expect(result.current.error).toBe('Rate limit reached')
    expect(result.current.loading).toBe(false)
  })

  it.each(['project', 'repository', 'account'])('ignores responses from a previous %s', async (kind) => {
    let finish!: (value: DashboardSnapshot) => void
    invokeDb.mockReturnValueOnce(new Promise<DashboardSnapshot>((resolve) => { finish = resolve }))
      .mockResolvedValueOnce({ ...snapshot, viewerLogin: 'new-lead' })
    const { result, rerender } = renderHook(({ id, context }) => useLeadDashboard(id, true, context), {
      initialProps: { id: 'first', context: 'repo:account-1' }
    })
    rerender(kind === 'project' ? { id: 'second', context: 'repo:account-1' }
      : { id: 'first', context: kind === 'repository' ? 'repo-new:account-1' : 'repo:account-2' })
    await act(async () => {})
    await act(async () => { finish(snapshot) })

    expect(result.current.snapshot?.viewerLogin).toBe('new-lead')
    expect(result.current.loading).toBe(false)
  })

  it('clears account data on disconnect and does not fetch', async () => {
    invokeDb.mockResolvedValue(snapshot)
    const { result, rerender } = renderHook(({ enabled }) => useLeadDashboard('project-1', enabled, 'repo'), {
      initialProps: { enabled: true }
    })
    await act(async () => {})
    rerender({ enabled: false })

    expect(result.current.snapshot).toBeNull()
    await act(async () => { await result.current.refresh() })
    expect(invokeDb).toHaveBeenCalledTimes(1)
  })

  it('does not poll while an earlier request is pending and stops after unmount', async () => {
    vi.useFakeTimers()
    invokeDb.mockReturnValue(new Promise(() => {}))
    const { unmount } = renderHook(() => useLeadDashboard('project-1', true, 'repo'))
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })

    expect(invokeDb).toHaveBeenCalledTimes(1)
    unmount()
    await vi.advanceTimersByTimeAsync(600_000)
    expect(invokeDb).toHaveBeenCalledTimes(1)
  })
})
