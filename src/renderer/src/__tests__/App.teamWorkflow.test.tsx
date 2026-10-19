// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Project } from '../types'

describe('App team workflow', () => {
  afterEach(cleanup)

  it('clones from the welcome screen, opens the project, and shows its lead dashboard', async () => {
    let projects: Project[] = []
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'db:projects:list') return projects
      if (channel === 'db:preferences:get') return { theme: 'light', mode: 'newbie', language: 'ko', auto_save_enabled: false, default_save_message_template: '' }
      if (channel === 'git:install:check') return { installed: true }
      if (channel === 'auth:token:exists') return true
      if (channel === 'ai:connection:get') return { provider: null, connection_status: 'disconnected', selected_model: null, available_models: [], last_verified_at: null }
      if (channel === 'ai:project-settings:get') return { auto_save_message_enabled: false, ai_diff_consent_granted: false, ai_diff_consent_granted_at: null }
      if (channel === 'cloud:target:get') return { mode: 'none', collaboration: null, backup: null }
      if (channel === 'dialog:openFolder') return '/projects'
      if (channel === 'project-setup:clone') {
        const input = args[0] as { repositoryUrl: string; directoryName: string }
        expect(input.repositoryUrl).toBe('https://github.com/team/new-project')
        projects = [{ project_id: 'cloned', local_path: '/projects/new-project', friendly_name: 'new-project', last_accessed: 1 }]
        return { ok: true, project: projects[0] }
      }
      if (channel === 'git:status') return { data: { current_branch: 'main', files: [], tracked_files: ['README.md'], ahead: 0, behind: 0, has_conflicts: false, is_clean: true } }
      if (channel === 'git:branches') return { data: [{ name: 'main', current: true }] }
      if (channel === 'git:branch:default') return { data: 'main' }
      if (channel === 'dashboard:get') return {
        repository: { owner: 'team', name: 'new-project', url: 'https://github.com/team/new-project', defaultBranch: 'main' },
        viewerLogin: 'lead', fetchedAt: '2026-10-19T20:00:00Z', pullRequests: [], issues: [], recentRuns: [], warnings: []
      }
      return null
    })
    Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: { invoke, on: vi.fn(), removeAllListeners: vi.fn() } } })
    render(<App />)
    await screen.findByText('Welcome')
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'GitHub에서 복제' })).toHaveLength(2))
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'GitHub에서 복제' }))
    const dialog = await screen.findByRole('dialog', { name: 'GitHub 프로젝트 가져오기' })
    fireEvent.change(within(dialog).getByLabelText('GitHub 저장소 HTTPS 주소'), { target: { value: 'https://github.com/team/new-project' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '폴더 선택' }))
    await waitFor(() => expect(within(dialog).getByText('/projects')).toBeTruthy())
    fireEvent.click(within(dialog).getByRole('button', { name: '가져오고 열기' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'GitHub 프로젝트 가져오기' })).toBeNull())
    expect(screen.getAllByText('new-project').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '리드 대시보드' }))
    await screen.findByRole('link', { name: 'team/new-project ↗' })
    expect(invoke).toHaveBeenCalledWith('dashboard:get', 'cloned', true)
    expect(screen.queryByRole('button', { name: '진행 상황 저장' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '파일로 돌아가기' }))
    expect(screen.queryByRole('heading', { name: '리드 대시보드' })).toBeNull()
  })
})
