// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectSettingsPanel } from '../components/ProjectSettingsPanel/ProjectSettingsPanel'
import { ProjectAiSettings } from '../types'

afterEach(cleanup)

vi.mock('../hooks/useTerms', () => ({
  useTerms: () => ({
    projectSettingsTitle: '프로젝트 설정',
    projectSettingsDescription: '이 프로젝트의 AI 저장 메시지와 클라우드 업로드 상태를 확인합니다.',
    closeProjectSettingsLabel: '프로젝트 설정 닫기',
    aiSaveMessagesTitle: 'AI 저장 메시지',
    useAiAutoSaveMessagesLabel: 'AI 자동 저장 메시지 사용',
    aiConnectionLabel: 'AI 연결',
    aiConnectedLabel: '연결됨',
    aiConnectProviderFirstLabel: 'AI provider를 먼저 연결하세요',
    modelLabel: '모델',
    noneSelectedLabel: '선택 안 됨',
    diffConsentLabel: 'AI 데이터 공유',
    allowAiDataSharingLabel: '이 프로젝트의 AI 데이터 공유 허용',
    aiDataSharingDescription: '관련 diff, 파일 일부, 충돌 내용, 파일 경로, 커밋 기록을 AI provider로 전송합니다.',
    diffConsentGrantedLabel: '허용됨',
    diffConsentNotGrantedLabel: '아직 허용 안 됨',
    openConnectAiBtn: 'AI 연결 열기',
    cloudUploadTitle: '클라우드 업로드',
    statusLabel: '상태',
    privateBackupReadyLabel: 'private 백업 준비됨',
    teamUploadReadyLabel: '팀 업로드 준비됨',
    cloudBackupNotSetUpLabel: '클라우드 백업 미설정',
    defaultBranchLabel: '기본 branch',
    protectedBranchSuffix: '보호됨',
    notDetectedYetLabel: '아직 감지 안 됨',
    repositoryLabel: '저장소',
    remoteLabel: 'remote',
    branchLabel: 'branch',
    notChosenLabel: '선택 안 됨',
    setupCloudUploadBtn: '클라우드 업로드 설정',
    changeUploadTargetBtn: '업로드 대상 변경'
  })
}))

function renderSettings(aiSettings: Partial<ProjectAiSettings> = {}, connected = true) {
  const onAiChange = vi.fn()
  render(
    <ProjectSettingsPanel
      aiSettings={{
        auto_save_message_enabled: false,
        ai_diff_consent_granted: false,
        ai_diff_consent_granted_at: null,
        ...aiSettings
      }}
      aiConnectionStatus={connected ? 'connected' : 'disconnected'}
      selectedModel={connected ? 'test-model' : null}
      cloudTarget={{ mode: 'none', backup: null, collaboration: null }}
      protectedBranch="main"
      onAiChange={onAiChange}
      onOpenAiConnection={vi.fn()}
      onOpenCloudSetup={vi.fn()}
      onClose={vi.fn()}
    />
  )
  return onAiChange
}

describe('ProjectSettingsPanel', () => {
  it('shows AI and cloud state together', () => {
    render(
      <ProjectSettingsPanel
        aiSettings={{
          auto_save_message_enabled: true,
          ai_diff_consent_granted: true,
          ai_diff_consent_granted_at: 1
        }}
        aiConnectionStatus="connected"
        selectedModel="gpt-4.1-mini"
        protectedBranch="main"
        cloudTarget={{
          mode: 'backup',
          backup: {
            remoteName: 'gat-backup',
            repoOwner: 'tony',
            repoName: 'demo-backup',
            private: true
          },
          collaboration: null
        }}
        onAiChange={vi.fn()}
        onOpenAiConnection={vi.fn()}
        onOpenCloudSetup={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText(/AI 자동 저장 메시지 사용/i)).toBeTruthy()
    expect(screen.getByText(/private 백업 준비됨/i)).toBeTruthy()
  })
})

describe('project AI sharing control', () => {
  it('grants consent for manual tools without enabling auto-save', () => {
    const onAiChange = renderSettings()

    fireEvent.click(screen.getByRole('checkbox', { name: '이 프로젝트의 AI 데이터 공유 허용' }))

    expect(onAiChange).toHaveBeenCalledWith({ ai_diff_consent_granted: true })
    expect(screen.getByText(/파일 일부, 충돌 내용, 파일 경로, 커밋 기록/)).toBeTruthy()
  })

  it('revokes consent and disables auto-save even after disconnecting the provider', () => {
    const onAiChange = renderSettings({
      auto_save_message_enabled: true,
      ai_diff_consent_granted: true
    }, false)
    const consent = screen.getByRole('checkbox', { name: '이 프로젝트의 AI 데이터 공유 허용' })

    expect(consent.hasAttribute('disabled')).toBe(false)
    fireEvent.click(consent)

    expect(onAiChange).toHaveBeenCalledWith({
      ai_diff_consent_granted: false,
      auto_save_message_enabled: false
    })
  })
})
