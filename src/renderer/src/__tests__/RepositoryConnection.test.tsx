// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRepositoryConnectionState, parseGithubRemoteIdentity, RepositoryConnection } from '../components/RepositoryConnection/RepositoryConnection'
import type { RepositoryConnectionInspection } from '../hooks/useRepositoryConnection'
import type { ProjectCloudTarget, ProjectRemote } from '../types'

const noTarget: ProjectCloudTarget = { mode: 'none', backup: null, collaboration: null }
const collaboration: ProjectCloudTarget = {
  mode: 'collaboration', backup: null,
  collaboration: { remoteName: 'origin', repoOwner: 'team', repoName: 'project', branchMode: 'existing_branch', selectedBranch: 'feature/work' }
}
const backup: ProjectCloudTarget = {
  mode: 'backup', backup: { remoteName: 'gat-backup', repoOwner: 'person', repoName: 'project-backup', private: true }, collaboration: null
}
const remote = (name = 'origin', fetch = 'https://github.com/team/project.git', push = fetch): ProjectRemote => ({ name, fetch, push })
const inspection = (remotes: ProjectRemote[] = [remote()], isGitRepo = true): RepositoryConnectionInspection => ({ isGitRepo, remotes })

afterEach(cleanup)

describe('folder GitHub connection', () => {
  it.each([
    ['git@github.com:Team/project.git', { owner: 'Team', repo: 'project' }],
    ['ssh://git@github.com:22/team/project.git', { owner: 'team', repo: 'project' }],
    ['https://secret-token@github.com/team/project.git', { owner: 'team', repo: 'project' }],
    ['https://github.com/team/project/', { owner: 'team', repo: 'project' }],
    ['https://gitlab.com/team/project.git', null],
    ['https://github.com.evil.example/team/project.git', null],
    ['https://github.com@evil.example/team/project.git', null],
    ['https://github.com/team/project/issues', null],
    ['https://github.com/team/project.git?token=secret', null],
    ['https://github.com/team/%3Cscript%3E.git', null]
  ])('extracts only safe GitHub identity from %s', (url, expected) => {
    expect(parseGithubRemoteIdentity(url)).toEqual(expected)
  })

  it('distinguishes a non-repository, local Git history, and a different Git host', () => {
    expect(getRepositoryConnectionState(inspection([], false), noTarget, false, false).kind).toBe('no-git')
    expect(getRepositoryConnectionState(inspection([]), noTarget, true, false).kind).toBe('local-only')
    expect(getRepositoryConnectionState(inspection([remote('origin', 'https://gitlab.com/team/project.git')]), noTarget, true, false).kind).toBe('other-remote')
  })

  it('does not equate a remote URL with account login or an upload destination', () => {
    expect(getRepositoryConnectionState(inspection(), noTarget, false, false).kind).toBe('account-missing')
    expect(getRepositoryConnectionState(inspection(), noTarget, true, false).kind).toBe('target-unset')
    const state = getRepositoryConnectionState(inspection(), collaboration, true, true)
    expect(state.kind).toBe('configured')
    expect(state.repository).toBe('team/project')
    expect(state.branch).toBe('feature/work')
  })

  it.each([
    remote('origin', 'https://github.com/team/project.git', 'https://github.com/stranger/project.git'),
    remote('origin', 'https://github.com/team/project.git', 'https://gitlab.com/team/project.git'),
    remote('origin', 'https://github.com/stranger/project.git')
  ])('flags changed or split configured addresses', (changedRemote) => {
    expect(getRepositoryConnectionState(inspection([changedRemote]), collaboration, true, true).kind).toBe('remote-mismatch')
  })

  it('warns about split fetch/push addresses before selecting an upload target', () => {
    expect(getRepositoryConnectionState(inspection([remote('origin', 'https://github.com/team/project.git', 'git@github.com:fork/project.git')]), noTarget, true, false).kind).toBe('remote-mismatch')
  })

  it('accepts equivalent SSH/HTTPS and case-insensitive repository identities', () => {
    expect(getRepositoryConnectionState(inspection([remote('origin', 'git@github.com:Team/Project.git')]), collaboration, true, true).kind).toBe('configured')
  })

  it('checks the backup remote independently of the team origin and explains lazy creation', () => {
    const teamAndBackup = inspection([remote(), remote('gat-backup', 'git@github.com:person/project-backup.git')])
    expect(getRepositoryConnectionState(teamAndBackup, backup, true, true).kind).toBe('backup-configured')
    const pending = getRepositoryConnectionState(inspection([]), backup, true, true)
    expect(pending.kind).toBe('backup-configured')
    expect(pending.backupRemotePending).toBe(true)
    expect(pending.repository).toBe('person/project-backup')
    expect(getRepositoryConnectionState(inspection([remote('gat-backup')]), backup, true, true).kind).toBe('remote-mismatch')
  })

  it('shows local-only guidance and routes the setup action without uploading', () => {
    const onSetup = vi.fn()
    render(<RepositoryConnection language="ko" inspection={inspection([])} loading={false} error={null}
      cloudTarget={noTarget} accountConnected={false} uploadReady={false} onSetup={onSetup} onConnectAccount={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toBe('GitHub 미연결 · 내 컴퓨터에만 저장')
    expect(screen.getByText(/진행 상황 저장\(commit\)은 이 컴퓨터/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '올릴 위치 설정' }))
    expect(onSetup).toHaveBeenCalledOnce()
  })

  it('renders identities and configuration limits without remote credentials or raw errors', () => {
    const { container, rerender } = render(<RepositoryConnection language="en" inspection={inspection([remote('origin', 'https://secret-token@github.com/team/project.git')])} loading={false} error={null}
      cloudTarget={collaboration} accountConnected uploadReady onSetup={vi.fn()} onConnectAccount={vi.fn()} onRetry={vi.fn()} />)
    expect(screen.getByText('team/project')).toBeTruthy()
    expect(screen.getByText(/Only addresses and settings were checked/)).toBeTruthy()
    expect(container.textContent).not.toContain('secret-token')
    expect(container.textContent).not.toContain('https://')
    rerender(<RepositoryConnection language="en" inspection={null} loading={false} error="Failed at https://secret-token@github.com/team/project.git"
      cloudTarget={noTarget} accountConnected={false} uploadReady={false} onSetup={vi.fn()} onConnectAccount={vi.fn()} onRetry={vi.fn()} />)
    expect(container.textContent).not.toContain('secret-token')
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy()
  })
})
