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

const project = { project_id: 'project-1', local_path: '/tmp/project', friendly_name: 'Demo', last_accessed: 0 }
const legacy: ProjectCloudTarget = {
  mode: 'collaboration', backup: null,
  collaboration: { remoteName: 'origin', branchMode: 'existing_branch', selectedBranch: 'feature/work' }
}
const verified: ProjectCloudTarget = {
  ...legacy,
  collaboration: { ...legacy.collaboration!, repoOwner: 'team', repoName: 'project' }
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { cleanup() })

describe('team target identity migration', () => {
  it('opens setup for an older target and becomes upload-ready after verification', async () => {
    vi.mocked(invokeDb).mockImplementation(async (channel) => {
      if (channel === 'cloud:target:get') return legacy
      if (channel === 'project-setup:inspect') return {
        remotes: [{ name: 'origin', fetch: 'https://github.com/team/project.git', push: 'https://github.com/team/project.git' }]
      }
      if (channel === 'cloud:collaboration:set') return verified
      throw new Error(`Unexpected channel: ${channel}`)
    })
    const onReadyToUpload = vi.fn()
    const { result } = renderHook(() => useCloudSetup(project, { onReadyToUpload }))
    await waitFor(() => expect(result.current.target.mode).toBe('collaboration'))
    expect(result.current.cloudUploadReady).toBe(false)
    expect(result.current.cloudStatusLabel).toBe('Setup needed')

    await act(async () => { await result.current.open(true) })
    expect(result.current.isOpen).toBe(true)
    await act(async () => { await result.current.saveCollaborationTarget() })
    expect(result.current.cloudUploadReady).toBe(true)
    expect(result.current.isOpen).toBe(false)
    expect(onReadyToUpload).toHaveBeenCalledWith(verified)
  })

  it('keeps an already verified team target ready for upload', async () => {
    vi.mocked(invokeDb).mockResolvedValue(verified)
    const { result } = renderHook(() => useCloudSetup(project))
    await waitFor(() => expect(result.current.cloudUploadReady).toBe(true))
    expect(result.current.cloudStatusLabel).toBe('Team branch ready')
  })
})
