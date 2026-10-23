// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { getTerms } from '../i18n/terms'
import type { GitStatus } from '../types'

afterEach(cleanup)

function installIpc(options: { plainFolder?: boolean; backup?: boolean; language?: 'en' | 'ko'; mode?: 'newbie' | 'pro' } = {}) {
  let initialized = !options.plainFolder
  let backupRemoteInstalled = false
  const status: GitStatus = {
    current_branch: 'main',
    files: [{ path: 'README.md', status: 'modified', staged: false }],
    tracked_files: ['README.md'],
    ahead: 0, behind: 0, has_conflicts: false, is_clean: false
  }
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'db:projects:list') return [{ project_id: 'demo', local_path: '/projects/demo', friendly_name: 'Demo', last_accessed: 0 }]
    if (channel === 'db:preferences:get') return { theme: 'light', mode: options.mode ?? 'newbie', language: options.language ?? 'ko', auto_save_enabled: false, default_save_message_template: '' }
    if (channel === 'git:install:check') return { installed: true }
    if (channel === 'auth:token:exists') return Boolean(options.backup)
    if (channel === 'ai:connection:get') return { provider: null, connection_status: 'disconnected', selected_model: null, available_models: [], last_verified_at: null }
    if (channel === 'ai:project-settings:get') return { auto_save_message_enabled: false, ai_diff_consent_granted: false, ai_diff_consent_granted_at: null }
    if (channel === 'cloud:target:get') return options.backup
      ? { mode: 'backup', collaboration: null, backup: { remoteName: 'viva-backup', repoOwner: 'me', repoName: 'demo', private: true } }
      : { mode: 'none', collaboration: null, backup: null }
    if (channel === 'project-setup:connection') return {
      isGitRepo: initialized,
      remotes: backupRemoteInstalled ? [{ name: 'viva-backup', fetch: 'https://github.com/me/demo.git', push: 'https://github.com/me/demo.git' }] : []
    }
    if (channel === 'git:status') return initialized
      ? { data: { ...status, files: status.files.map((file) => ({ ...file })) } }
      : { error: { code: 'NOT_A_REPO', message: 'Not a Git repository' } }
    if (channel === 'git:branches') return { data: [{ name: 'main', current: true }] }
    if (channel === 'git:branch:default') return { data: 'main' }
    if (channel === 'git:init') { initialized = true; return { data: undefined } }
    if (channel === 'git:stage') { status.files[0].staged = true; return { data: undefined } }
    if (channel === 'git:commit') { status.files = []; status.is_clean = true; return { data: 'saved' } }
    if (channel === 'git:push') {
      backupRemoteInstalled = true
      return { data: { remoteName: 'viva-backup', branchName: 'main', prUrl: null } }
    }
    return null
  })
  Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: { invoke, on: vi.fn(), removeAllListeners: vi.fn() } } })
  return invoke
}

describe('beginner save workflow', () => {
  it('opens file explanations without staging, stages with a checkbox, and saves locally without uploading', async () => {
    const user = userEvent.setup()
    const invoke = installIpc()
    render(<App />)

    const name = await screen.findByText('README.md')
    const save = screen.getByRole('button', { name: '진행 상황 저장' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.getByText(getTerms('ko', 'newbie').selectChangesSaveHint)).toBeTruthy()

    await user.click(name)
    expect(invoke.mock.calls.some(([channel]) => channel === 'git:stage')).toBe(false)
    expect(invoke.mock.calls.some(([channel]) => channel === 'git:commit')).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: 'README.md 선택' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:stage', 'demo', ['README.md']))
    await screen.findByText(getTerms('ko', 'newbie').describeChangesSaveHint)
    await user.type(screen.getByPlaceholderText('변경 내용을 설명하세요...'), '문서 내용 수정')
    await user.click(screen.getByRole('button', { name: '진행 상황 저장 (1)' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('git:commit', 'demo', '문서 내용 수정', undefined))
    expect(invoke.mock.calls.some(([channel]) => channel === 'git:push')).toBe(false)
    await screen.findByText(getTerms('ko', 'newbie').noChangesSaveHint)
  })

  it.each(['newbie', 'pro'] as const)('keeps the compact guidance in English and updates it through the language controls in %s mode', async (mode) => {
    const user = userEvent.setup()
    const invoke = installIpc({ language: 'en', mode })
    render(<App />)

    await screen.findByText('README.md')
    const englishGuide = screen.getByRole('region', { name: 'How to save changes' })
    const englishConnection = screen.getByRole('region', { name: 'GitHub connection for this folder' })
    const workflowDetails = englishGuide.querySelector('details')!
    expect(workflowDetails.open).toBe(false)
    await user.click(within(englishGuide).getByText('Saving guide'))
    expect(workflowDetails.open).toBe(true)
    for (const command of ['git add', 'git commit', 'git push']) {
      expect(within(englishGuide).getByText(command)).toBeTruthy()
    }
    const connectionSummary = englishConnection.querySelector('summary')
    if (connectionSummary) await user.click(connectionSummary)
    const assertEnglishHelp = (): void => {
      const guide = screen.getByRole('region', { name: 'How to save changes' })
      const connection = screen.getByRole('region', { name: 'GitHub connection for this folder' })
      const saveHint = document.getElementById('save-step-hint')!
      expect(`${guide.textContent} ${connection.textContent} ${saveHint.textContent}`).not.toMatch(/[가-힣]/)
      expect(saveHint.textContent).toBe(getTerms('en', mode).selectChangesSaveHint)
    }
    assertEnglishHelp()

    await user.click(screen.getByRole('button', { name: 'KO' }))
    const koreanGuide = await screen.findByRole('region', { name: '변경사항 저장 안내' })
    expect(within(koreanGuide).getByText('파일 클릭')).toBeTruthy()
    expect(screen.getByRole('region', { name: '이 폴더의 GitHub 연결 상태' }).textContent).toMatch(/[가-힣]/)
    expect(document.getElementById('save-step-hint')!.textContent).toBe(getTerms('ko', mode).selectChangesSaveHint)

    await user.click(screen.getByRole('button', { name: 'EN' }))
    await screen.findByRole('region', { name: 'How to save changes' })
    assertEnglishHelp()
    expect(invoke).toHaveBeenCalledWith('db:preferences:set', 'language', 'ko')
    expect(invoke).toHaveBeenCalledWith('db:preferences:set', 'language', 'en')
    expect(invoke.mock.calls.some(([channel]) => ['git:stage', 'git:commit', 'git:push'].includes(channel))).toBe(false)
  })

  it('updates the connection banner immediately after setting up Git in a plain folder', async () => {
    const user = userEvent.setup()
    installIpc({ plainFolder: true })
    render(<App />)
    await screen.findByText('Git 저장소가 아닌 폴더예요')
    const setupButtons = screen.getAllByRole('button', { name: '프로젝트 설정' })
    await user.click(setupButtons[setupButtons.length - 1])
    await screen.findByText('GitHub 미연결 · 내 컴퓨터에만 저장')
    expect(screen.queryByText('Git 저장소가 아닌 폴더예요')).toBeNull()
  })

  it('refreshes the configured backup address after Upload installs its remote', async () => {
    const user = userEvent.setup()
    const invoke = installIpc({ backup: true })
    render(<App />)
    await screen.findByText(/아직 이 폴더에 백업용 GitHub 주소가 없습니다/)
    await user.click(screen.getByRole('button', { name: '올리기' }))
    await screen.findByText(/아래 개인 저장소로 현재 작업줄을 올리도록 설정돼 있습니다/)
    expect(screen.queryByText(/아직 이 폴더에 백업용 GitHub 주소가 없습니다/)).toBeNull()
    expect(invoke).toHaveBeenCalledWith('git:push', 'demo', undefined)
  })
})
