export type WorkflowLanguage = 'ko' | 'en'

interface WorkflowStep {
  title: string
  command: string
  description: string
}

interface WorkflowTerms {
  guideLabel: string
  fileClickLabel: string
  fileClickCopy: string
  checkboxLabel: string
  checkboxCopy: string
  detailsLabel: string
  steps: WorkflowStep[]
  localOnlyNote: string
}

export const workflowTerms: Record<WorkflowLanguage, WorkflowTerms> = {
  ko: {
    guideLabel: '변경사항 저장 안내',
    fileClickLabel: '파일 클릭',
    fileClickCopy: 'AI 설명',
    checkboxLabel: '체크',
    checkboxCopy: '저장에 포함',
    detailsLabel: '저장 흐름 안내',
    steps: [
      {
        title: '체크박스로 선택',
        command: 'git add',
        description: '체크한 변경만 다음 저장에 포함해요. 파일 클릭은 저장 선택을 바꾸지 않아요.'
      },
      {
        title: '진행 상황 저장',
        command: 'git commit',
        description: '메시지를 적고 저장하면 내 컴퓨터에 기록돼요.'
      },
      {
        title: '올리기',
        command: 'git push',
        description: '저장한 기록을 설정된 GitHub 저장소로 보내요.'
      }
    ],
    localOnlyNote: '저장만으로는 GitHub에 올라가지 않아요.'
  },
  en: {
    guideLabel: 'How to save changes',
    fileClickLabel: 'File click',
    fileClickCopy: 'AI explanation',
    checkboxLabel: 'Checkbox',
    checkboxCopy: 'include in save',
    detailsLabel: 'Saving guide',
    steps: [
      {
        title: 'Select with checkboxes',
        command: 'git add',
        description: 'Check changes to include in your next save. Clicking a file does not stage it.'
      },
      {
        title: 'Save Progress',
        command: 'git commit',
        description: 'Write a message and save a record on this computer.'
      },
      {
        title: 'Upload',
        command: 'git push',
        description: 'Send saved commits to the configured GitHub repository.'
      }
    ],
    localOnlyNote: 'Saving does not automatically upload to GitHub.'
  }
}
