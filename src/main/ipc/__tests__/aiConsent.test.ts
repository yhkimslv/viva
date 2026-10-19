import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectAiSettings } from '../../db/projectAiSettings'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getProjectAiSettings: vi.fn(),
  setProjectAiSettings: vi.fn(),
  getPreferences: vi.fn(),
  getGitService: vi.fn(),
  weeklyService: vi.fn(),
  git: {
    getStagedDiff: vi.fn(),
    getStagedDiffContext: vi.fn(),
    getConflictVersions: vi.fn()
  },
  ai: {
    connectProvider: vi.fn(),
    generateAutoSaveMessage: vi.fn(),
    generateCommitSuggestion: vi.fn(),
    generateStructured: vi.fn(),
    supportsManualTools: vi.fn()
  },
  generateFileInsight: vi.fn(),
  generateNaturalUndoSuggestion: vi.fn(),
  reviewUntrackedFiles: vi.fn(),
  generateWeeklySummary: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../ai/service', () => ({ createAiService: () => mocks.ai }))
vi.mock('../../ai/manualToolService', () => ({ createManualToolService: () => ({}) }))
vi.mock('../../ai/fileInsightService', () => ({ generateFileInsight: mocks.generateFileInsight }))
vi.mock('../../ai/naturalUndoService', () => ({
  generateNaturalUndoSuggestion: mocks.generateNaturalUndoSuggestion
}))
vi.mock('../../ai/untrackedReviewService', () => ({ reviewUntrackedFiles: mocks.reviewUntrackedFiles }))
vi.mock('../../ai/weeklySummaryService', () => ({ generateWeeklySummary: mocks.generateWeeklySummary }))
vi.mock('../../db/projectAiSettings', () => ({
  getProjectAiSettings: mocks.getProjectAiSettings,
  setProjectAiSettings: mocks.setProjectAiSettings
}))
vi.mock('../../db/aiConnection', () => ({
  getAiConnectionState: () => ({
    provider: 'openai', selected_model: 'test-model', connection_status: 'connected'
  }),
  clearAiConnectionState: vi.fn(),
  setAiConnectionState: vi.fn()
}))
vi.mock('../../db/credentials', () => ({
  getAiApiKey: () => 'test-key', setAiApiKey: vi.fn(), clearAiApiKey: vi.fn()
}))
vi.mock('../../db/preferences', () => ({ getPreferences: mocks.getPreferences }))
vi.mock('../../db/projects', () => ({
  listProjects: () => [{ project_id: 'project-1', local_path: '/project', friendly_name: 'Project' }]
}))
vi.mock('../../db/aiSummaries', () => ({ getAiCommitSummariesByHash: vi.fn() }))
vi.mock('../../db/weeklySummaryCache', () => ({
  getCachedWeeklySummary: vi.fn(), setCachedWeeklySummary: vi.fn()
}))
vi.mock('../../git', () => ({ getGitService: mocks.getGitService }))
vi.mock('../../git/weekly-service', () => ({ GitWeeklyService: mocks.weeklyService }))

import { registerAiHandlers } from '../ai'

type IpcHandler = (_event: unknown, ...args: unknown[]) => unknown

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const registration = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!registration) throw new Error(`Handler not registered: ${channel}`)
  return Promise.resolve((registration[1] as IpcHandler)({}, ...args))
}

function settings(patch: Partial<ProjectAiSettings> = {}): ProjectAiSettings {
  return {
    auto_save_message_enabled: false,
    ai_diff_consent_granted: false,
    ai_diff_consent_granted_at: null,
    ...patch
  }
}

describe('project AI consent at IPC boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPreferences.mockReturnValue({ language: 'en' })
    mocks.getProjectAiSettings.mockReturnValue(settings())
    mocks.getGitService.mockReturnValue(mocks.git)
    mocks.ai.supportsManualTools.mockReturnValue(true)
    mocks.git.getStagedDiff.mockResolvedValue('staged source content')
    mocks.git.getStagedDiffContext.mockResolvedValue({ diff: 'staged source content' })
    mocks.git.getConflictVersions.mockResolvedValue({ ours: 'our source', theirs: 'their source' })
    mocks.ai.generateCommitSuggestion.mockResolvedValue({ message: 'Draft message' })
    mocks.ai.generateAutoSaveMessage.mockResolvedValue('Draft message')
    registerAiHandlers()
  })

  it.each([
    ['ai:commit-suggestion', []],
    ['ai:undo:suggest', ['before the last change']],
    ['ai:file:insight', ['src/app.ts']],
    ['ai:untracked:review', []],
    ['ai:conflict:analyze', ['src/app.ts']],
    ['ai:weekly:summary', ['2026-10-12', '2026-10-18']]
  ])('blocks %s before reading source or calling an AI provider without consent', async (channel, args) => {
    await expect(invoke(channel, 'project-1', ...args)).rejects.toThrow('Project Settings')

    expect(mocks.getGitService).not.toHaveBeenCalled()
    expect(mocks.weeklyService).not.toHaveBeenCalled()
    expect(mocks.ai.generateCommitSuggestion).not.toHaveBeenCalled()
    expect(mocks.ai.generateStructured).not.toHaveBeenCalled()
    expect(mocks.ai.generateAutoSaveMessage).not.toHaveBeenCalled()
    expect(mocks.generateFileInsight).not.toHaveBeenCalled()
    expect(mocks.generateNaturalUndoSuggestion).not.toHaveBeenCalled()
    expect(mocks.reviewUntrackedFiles).not.toHaveBeenCalled()
    expect(mocks.generateWeeklySummary).not.toHaveBeenCalled()
  })

  it('keeps auto-save generation disabled without project consent', async () => {
    mocks.getProjectAiSettings.mockReturnValue(settings({ auto_save_message_enabled: true }))

    await expect(invoke('ai:auto-save-message:generate', 'project-1')).resolves.toBeNull()
    expect(mocks.getGitService).not.toHaveBeenCalled()
    expect(mocks.ai.generateAutoSaveMessage).not.toHaveBeenCalled()
  })

  it('allows a manual suggestion after consent without enabling auto-save', async () => {
    mocks.getProjectAiSettings.mockReturnValue(settings({ ai_diff_consent_granted: true }))

    await expect(invoke('ai:commit-suggestion', 'project-1')).resolves.toEqual({ message: 'Draft message' })
    expect(mocks.ai.generateCommitSuggestion).toHaveBeenCalledWith(expect.objectContaining({
      diff: 'staged source content'
    }))
    expect(mocks.ai.generateAutoSaveMessage).not.toHaveBeenCalled()
  })

  it('checks consent again after it is revoked', async () => {
    mocks.getProjectAiSettings.mockReturnValue(settings({ ai_diff_consent_granted: true }))
    await invoke('ai:commit-suggestion', 'project-1')
    mocks.ai.generateCommitSuggestion.mockClear()
    mocks.getGitService.mockClear()
    mocks.getProjectAiSettings.mockReturnValue(settings())

    await expect(invoke('ai:commit-suggestion', 'project-1')).rejects.toThrow('Project Settings')
    expect(mocks.getGitService).not.toHaveBeenCalled()
    expect(mocks.ai.generateCommitSuggestion).not.toHaveBeenCalled()
  })

  it('does not reuse consent from another project', async () => {
    mocks.getProjectAiSettings.mockImplementation((projectId: string) =>
      settings({ ai_diff_consent_granted: projectId === 'project-1' })
    )

    await invoke('ai:commit-suggestion', 'project-1')
    await expect(invoke('ai:commit-suggestion', 'project-2')).rejects.toThrow('Project Settings')
    expect(mocks.ai.generateCommitSuggestion).toHaveBeenCalledOnce()
  })

  it.each([
    ['ai:undo:suggest', ['before the last change'], mocks.generateNaturalUndoSuggestion],
    ['ai:file:insight', ['src/app.ts'], mocks.generateFileInsight],
    ['ai:untracked:review', [], mocks.reviewUntrackedFiles],
    ['ai:weekly:summary', ['2026-10-12', '2026-10-18'], mocks.generateWeeklySummary]
  ])('allows %s after project consent', async (channel, args, generate) => {
    mocks.getProjectAiSettings.mockReturnValue(settings({ ai_diff_consent_granted: true }))

    await invoke(channel, 'project-1', ...args)

    expect(generate).toHaveBeenCalledOnce()
  })

  it('allows conflict analysis after project consent', async () => {
    mocks.getProjectAiSettings.mockReturnValue(settings({ ai_diff_consent_granted: true }))
    mocks.ai.generateStructured.mockResolvedValue({
      recommendation: 'manual',
      reason: 'Review both versions',
      confidence: 0.5
    })

    await invoke('ai:conflict:analyze', 'project-1', 'src/app.ts')

    expect(mocks.ai.generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      userPrompt: expect.stringContaining('our source')
    }))
  })

  it('provides actionable Korean guidance when consent is missing', async () => {
    mocks.getPreferences.mockReturnValue({ language: 'ko' })

    await expect(invoke('ai:file:insight', 'project-1', 'src/app.ts')).rejects.toThrow('프로젝트 설정')
  })
})
