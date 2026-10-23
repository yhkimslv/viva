// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloudSetup } from '../hooks/useCloudSetup'
import { invokeDb } from '../ipc'
import type { ProjectCloudTarget } from '../types'

vi.mock('../ipc', () => ({ invokeDb: vi.fn() }))
vi.mock('../hooks/useTerms', () => ({ useTerms: () => ({
  privateBackupReadyLabel: 'Private backup ready', cloudBackupNotSetUpLabel: 'Setup needed',
  teamUploadReviewBranchStatus: () => 'Team branch ready', teamUploadExistingBranchStatus: () => 'Team branch ready',
  teamUploadDefaultBranchStatus: () => 'Default branch ready'
}) }))

const projectA = { project_id: 'project-a', local_path: '/tmp/a', friendly_name: 'A', last_accessed: 0 }
const projectB = { project_id: 'project-b', local_path: '/tmp/b', friendly_name: 'B', last_accessed: 0 }
const emptyTarget: ProjectCloudTarget = { mode: 'none', backup: null, collaboration: null }

function teamTarget(repoName: string, branchName = 'feature/work'): ProjectCloudTarget {
  return {
    mode: 'collaboration', backup: null,
    collaboration: {
      remoteName: 'origin', branchMode: 'existing_branch', selectedBranch: branchName,
      repoOwner: 'team', repoName
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const targetA = teamTarget('a')
const targetB = teamTarget('b')
const backupA: ProjectCloudTarget = {
  mode: 'backup', collaboration: null,
  backup: { remoteName: 'gat-backup', repoOwner: 'me', repoName: 'a-backup', private: true }
}
const inspection = {
  remotes: [{ name: 'origin', fetch: 'https://github.com/team/a.git', push: 'https://github.com/team/a.git' }]
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { cleanup() })

describe('cloud targets belong to the current project', () => {
  it('hides the previous target immediately while the next project loads', async () => {
    const nextTarget = deferred<ProjectCloudTarget>()
    vi.mocked(invokeDb).mockImplementation(async (_channel, projectId) =>
      projectId === projectA.project_id ? targetA : nextTarget.promise
    )
    const { result, rerender } = renderHook(({ project }) => useCloudSetup(project), {
      initialProps: { project: projectA }
    })
    await waitFor(() => expect(result.current.target).toEqual(targetA))

    rerender({ project: projectB })
    expect(result.current.target).toEqual(emptyTarget)
    expect(result.current.cloudUploadReady).toBe(false)
    expect(result.current.cloudStatusLabel).toBe('Setup needed')

    await act(async () => { nextTarget.resolve(targetB) })
    expect(result.current.target).toEqual(targetB)
  })

  it.each(['success', 'failure'] as const)(
    'ignores an old project request that finishes with %s after the new project loads',
    async (outcome) => {
      const oldTarget = deferred<ProjectCloudTarget>()
      vi.mocked(invokeDb).mockImplementation(async (_channel, projectId) =>
        projectId === projectA.project_id ? oldTarget.promise : targetB
      )
      const { result, rerender } = renderHook(({ project }) => useCloudSetup(project), {
        initialProps: { project: projectA }
      })
      rerender({ project: projectB })
      await waitFor(() => expect(result.current.target).toEqual(targetB))

      await act(async () => {
        if (outcome === 'success') oldTarget.resolve(targetA)
        else oldTarget.reject(new Error('Old project read failed'))
      })
      expect(result.current.target).toEqual(targetB)
      expect(result.current.cloudUploadReady).toBe(true)
    }
  )

  it.each(['success', 'failure'] as const)(
    'keeps the newest refresh when an older refresh later finishes with %s',
    async (outcome) => {
      const older = deferred<ProjectCloudTarget>()
      const newer = deferred<ProjectCloudTarget>()
      const updatedTarget = teamTarget('a', 'feature/new-work')
      vi.mocked(invokeDb)
        .mockResolvedValueOnce(targetA)
        .mockImplementationOnce(() => older.promise)
        .mockImplementationOnce(() => newer.promise)
      const { result } = renderHook(() => useCloudSetup(projectA))
      await waitFor(() => expect(result.current.target).toEqual(targetA))

      const oldRefresh = result.current.refreshTarget().catch(() => undefined)
      const newRefresh = result.current.refreshTarget()
      await act(async () => {
        newer.resolve(updatedTarget)
        await newRefresh
      })
      await act(async () => {
        if (outcome === 'success') older.resolve(targetA)
        else older.reject(new Error('Older refresh failed'))
        await oldRefresh
      })
      expect(result.current.target).toEqual(updatedTarget)
      expect(result.current.cloudUploadReady).toBe(true)
    }
  )

  it('keeps a newly created backup and its upload callback when an older read finishes later', async () => {
    const staleRead = deferred<ProjectCloudTarget>()
    const createdBackup = deferred<ProjectCloudTarget>()
    vi.mocked(invokeDb).mockImplementation(async (channel) => {
      if (channel === 'cloud:target:get') return staleRead.promise
      if (channel === 'project-setup:inspect') return inspection
      if (channel === 'cloud:backup:create') return createdBackup.promise
      throw new Error(`Unexpected channel: ${channel}`)
    })
    const onReadyToUpload = vi.fn()
    const { result } = renderHook(() => useCloudSetup(projectA, { onReadyToUpload }))
    await act(async () => { await result.current.open(true) })

    let createBackup!: Promise<void>
    act(() => { createBackup = result.current.createBackup() })
    const refreshDuringSetup = result.current.refreshTarget()
    await act(async () => {
      createdBackup.resolve(backupA)
      await createBackup
    })
    expect(result.current.target).toEqual(backupA)
    expect(onReadyToUpload).toHaveBeenCalledWith(backupA)

    await act(async () => {
      staleRead.resolve(emptyTarget)
      await refreshDuringSetup
    })
    expect(result.current.target).toEqual(backupA)
    expect(result.current.cloudUploadReady).toBe(true)
  })

  it('does not apply a previous project backup or start its pending upload after a switch', async () => {
    const createdBackup = deferred<ProjectCloudTarget>()
    vi.mocked(invokeDb).mockImplementation(async (channel, projectId) => {
      if (channel === 'cloud:target:get') return projectId === projectA.project_id ? targetA : targetB
      if (channel === 'project-setup:inspect') return inspection
      if (channel === 'cloud:backup:create') return createdBackup.promise
      throw new Error(`Unexpected channel: ${channel}`)
    })
    const onReadyToUpload = vi.fn()
    const { result, rerender } = renderHook(({ project }) => useCloudSetup(project, { onReadyToUpload }), {
      initialProps: { project: projectA }
    })
    await waitFor(() => expect(result.current.target).toEqual(targetA))
    await act(async () => { await result.current.open(true) })
    let createBackup!: Promise<void>
    act(() => { createBackup = result.current.createBackup() })

    rerender({ project: projectB })
    await waitFor(() => expect(result.current.target).toEqual(targetB))
    await act(async () => {
      createdBackup.resolve(backupA)
      await createBackup
    })
    expect(result.current.target).toEqual(targetB)
    expect(result.current.isOpen).toBe(false)
    expect(onReadyToUpload).not.toHaveBeenCalled()
  })
})
