// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { FileStatus, GitStatus } from '../types'

function makeStatus(paths: string[]): GitStatus {
  return {
    current_branch: 'feature/team-work',
    files: paths.map((path): FileStatus => ({ path, status: 'conflicted', staged: false })),
    tracked_files: [],
    ahead: 0,
    behind: 0,
    has_conflicts: paths.length > 0,
    is_clean: false
  }
}

function installIpc(options: { failCommit?: boolean; secondProject?: boolean } = {}) {
  const statuses: Record<string, GitStatus> = {
    team: makeStatus(['src/alpha.ts', 'src/beta.ts']),
    other: makeStatus(['src/alpha.ts'])
  }
  const projects = [{ project_id: 'team', friendly_name: 'Team project', local_path: '/team', created_at: 0, last_opened: 0 }]
  if (options.secondProject) {
    projects.push({ project_id: 'other', friendly_name: 'Other project', local_path: '/other', created_at: 0, last_opened: 0 })
  }
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'db:projects:list') return projects
    if (channel === 'db:preferences:get') {
      return { theme: 'light', mode: 'pro', language: 'en', auto_save_enabled: false, default_save_message_template: '' }
    }
    if (channel === 'git:install:check') return { installed: true }
    if (channel === 'auth:token:exists') return false
    if (channel === 'ai:connection:get') {
      return { provider: null, connection_status: 'disconnected', selected_model: null, available_models: [], last_verified_at: null }
    }
    if (channel === 'ai:project-settings:get') {
      return { auto_save_message_enabled: false, ai_diff_consent_granted: false, ai_diff_consent_granted_at: null }
    }
    if (channel === 'cloud:target:get') return { mode: 'none', backup: null, collaboration: null }
    if (channel === 'git:branches') return { data: [] }
    if (channel === 'git:branch:default') return { data: 'main' }
    if (channel === 'git:status') return { data: statuses[String(args[0])] }
    if (channel === 'git:conflict:resolve') {
      const projectId = String(args[0])
      statuses[projectId] = makeStatus(statuses[projectId].files.filter((file) => file.path !== args[1]).map((file) => file.path))
      return { data: undefined }
    }
    if (channel === 'git:commit') {
      return options.failCommit
        ? { error: { code: 'UNKNOWN', message: 'Commit hook rejected the merge.' } }
        : { data: undefined }
    }
    if (channel.startsWith('git:')) return { data: undefined }
    return null
  })
  const listeners = new Map<string, (...args: unknown[]) => void>()
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { ipcRenderer: {
      invoke,
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => { listeners.set(channel, listener) }),
      removeAllListeners: vi.fn((channel: string) => { listeners.delete(channel) })
    } }
  })
  return {
    invoke,
    statuses,
    notifyStatusChanged: (projectId: string) => listeners.get('db:status:changed')?.(undefined, projectId)
  }
}

async function resolveVisibleFiles(): Promise<void> {
  const dialog = await screen.findByRole('dialog', { name: 'Merge conflicts' })
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Keep mine' })[0])
  await waitFor(() => expect(within(dialog).getAllByText('Resolved')).toHaveLength(1))
  expect(within(dialog).queryByRole('button', { name: 'Complete merge' })).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep theirs' }))
  await waitFor(() => expect(within(dialog).getAllByText('Resolved')).toHaveLength(2))
}

describe('App conflict resolution', () => {
  afterEach(cleanup)

  it('allows completing a merge after Git reports that every conflict has been resolved', async () => {
    const { invoke } = installIpc()
    render(<App />)
    await resolveVisibleFiles()
    const dialog = screen.getByRole('dialog', { name: 'Merge conflicts' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete merge' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:commit', 'team', 'Merge branch', undefined))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Merge conflicts' })).toBeNull())
  })

  it('allows completing a merge after conflicts are manually edited and staged outside VIVA', async () => {
    const { invoke, statuses, notifyStatusChanged } = installIpc()
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Merge conflicts' })
    statuses.team = makeStatus([])
    act(() => { notifyStatusChanged('team') })

    await waitFor(() => expect(within(dialog).getAllByText('Resolved')).toHaveLength(2))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete merge' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:commit', 'team', 'Merge branch', undefined))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Merge conflicts' })).toBeNull())
    expect(invoke.mock.calls.some(([channel]) => channel === 'git:conflict:resolve')).toBe(false)
  })

  it('keeps the resolver open when the commit hook rejects merge completion', async () => {
    installIpc({ failCommit: true })
    render(<App />)
    await resolveVisibleFiles()
    const dialog = screen.getByRole('dialog', { name: 'Merge conflicts' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete merge' }))

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('Could not finish this step'))
    expect(screen.getByRole('dialog', { name: 'Merge conflicts' })).toBeTruthy()
    expect(within(dialog).getByRole('textbox', { name: 'Merge commit message' })).toBeTruthy()
  })

  it('does not reuse resolved paths when switching to another project with the same file path', async () => {
    installIpc({ secondProject: true })
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Merge conflicts' })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Keep mine' })[0])
    await waitFor(() => expect(within(dialog).getByText('Resolved')).toBeTruthy())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close conflict resolver' }))
    fireEvent.click(screen.getByRole('button', { name: '📁Other project ×' }))

    const nextDialog = await screen.findByRole('dialog', { name: 'Merge conflicts' })
    expect(within(nextDialog).queryByText('Resolved')).toBeNull()
    expect(within(nextDialog).getByRole('button', { name: 'Keep mine' })).toBeTruthy()
    expect(within(nextDialog).queryByRole('button', { name: 'Complete merge' })).toBeNull()
  })
})
