export function dashboardTerms(language: 'en' | 'ko') {
  return language === 'ko' ? {
    title: '리드 대시보드', subtitle: '리뷰할 PR과 CI 결과, 담당 이슈를 확인하세요.',
    back: '파일로 돌아가기', refresh: '새로고침', refreshing: '가져오는 중…',
    connectTitle: 'GitHub를 연결하세요', connectDescription: '연결된 계정으로 팀 저장소의 PR, 이슈, CI 상태를 읽어옵니다.',
    connect: 'GitHub 연결', setupTitle: '팀 저장소를 선택하세요',
    setupDescription: '프로젝트 설정에서 팀 업로드 대상을 선택하면 해당 저장소의 현황을 볼 수 있습니다.',
    setup: '팀 저장소 선택', selectTitle: '프로젝트를 선택하세요', selectDescription: '연결된 프로젝트의 팀 저장소 현황을 확인할 수 있습니다.',
    loadFailed: '현황을 가져오지 못했습니다', stale: '갱신에 실패했습니다. 아래는 마지막 조회 결과입니다.',
    loading: 'GitHub에서 팀 현황을 가져오는 중입니다.', updated: '조회 시각', viewer: '연결 계정',
    openPrs: '열린 PR', awaiting: '검토 대기', failing: 'CI 실패 PR', assigned: '담당 이슈',
    prs: 'Pull Request', all: '전체', requested: '내 리뷰 요청', checksFailed: 'CI 실패',
    prEmpty: '조건에 맞는 열린 PR이 없습니다.', issueEmpty: '조회된 담당 이슈가 없습니다.',
    workflows: '최근 CI 실행', runEmpty: '조회된 워크플로 실행이 없습니다.',
    issueTitle: '팀 담당 이슈', issueCopy: '담당자가 지정된 열린 이슈입니다.',
    draft: '초안', approved: '승인 의견 있음', changes_requested: '수정 요청', review_required: '검토 대기', unknown: '확인 필요',
    passing: 'CI 통과', failingState: 'CI 실패', pending: 'CI 진행 중', none: '검사 없음',
    success: '성공', failure: '실패', cancelled: '취소됨', skipped: '건너뜀', timed_out: '시간 초과',
    action_required: '조치 필요', neutral: '중립', in_progress: '진행 중', queued: '대기 중', waiting: '승인 대기',
    warnings: '조회 범위와 확인 사항', accountReview: '리뷰 요청', checkCopy: '검사',
    readOnly: '읽기 전용 · 열린 화면은 5분마다 갱신합니다. 리뷰와 병합은 GitHub에서 진행합니다.', branch: '브랜치', repository: '저장소',
    openGitHub: 'GitHub에서 열기', unassigned: '담당자 없음',
    unavailable: '조회하지 못함', issueUnavailable: '담당 이슈를 조회하지 못했습니다. 아래 안내에서 접근 권한과 조회 범위를 확인하세요.',
    runUnavailable: 'CI 실행을 조회하지 못했습니다. 아래 안내에서 접근 권한을 확인하세요.',
  } : {
    title: 'Lead dashboard', subtitle: 'Review pull requests, CI results, and assigned work.',
    back: 'Back to files', refresh: 'Refresh', refreshing: 'Refreshing…',
    connectTitle: 'Connect GitHub', connectDescription: 'Use your connected account to read pull requests, issues, and CI for the team repository.',
    connect: 'Connect GitHub', setupTitle: 'Choose a team repository',
    setupDescription: 'Set a team upload target in Project Settings to see that repository’s activity.',
    setup: 'Choose team repository', selectTitle: 'Select a project', selectDescription: 'Choose a linked project to see its team repository.',
    loadFailed: 'Could not load team activity', stale: 'Refresh failed. Showing the last successful result below.',
    loading: 'Loading team activity from GitHub.', updated: 'Last checked', viewer: 'Connected as',
    openPrs: 'Open PRs', awaiting: 'Awaiting review', failing: 'PRs with failing CI', assigned: 'Assigned issues',
    prs: 'Pull requests', all: 'All', requested: 'My review requests', checksFailed: 'Failing CI',
    prEmpty: 'No open pull requests match this filter.', issueEmpty: 'No assigned issues were returned.',
    workflows: 'Recent CI runs', runEmpty: 'No workflow runs were returned.',
    issueTitle: 'Assigned team issues', issueCopy: 'Open issues with an assigned owner.',
    draft: 'Draft', approved: 'Approval recorded', changes_requested: 'Changes requested', review_required: 'Awaiting review', unknown: 'Needs checking',
    passing: 'CI passing', failingState: 'CI failing', pending: 'CI running', none: 'No checks',
    success: 'Passed', failure: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped', timed_out: 'Timed out',
    action_required: 'Action required', neutral: 'Neutral', in_progress: 'Running', queued: 'Queued', waiting: 'Waiting for approval',
    warnings: 'Coverage and checks', accountReview: 'Review requested', checkCopy: 'checks',
    readOnly: 'Read only · Refreshes every 5 minutes while open. Review and merge on GitHub.', branch: 'Branch', repository: 'Repository',
    openGitHub: 'Open on GitHub', unassigned: 'Unassigned',
    unavailable: 'Unavailable', issueUnavailable: 'Assigned issues could not be loaded. Check access and coverage details below.',
    runUnavailable: 'Workflow runs could not be loaded. Check access details below.',
  }
}

export function dashboardErrorMessage(message: string, language: 'en' | 'ko'): string {
  const code = /\[([A-Z_]+)\]/.exec(message)?.[1]
  const ko: Record<string, string> = {
    NOT_CONNECTED: 'GitHub 로그인을 확인하고 다시 연결하세요.',
    SETUP_REQUIRED: '이 프로젝트의 GitHub 저장소를 확인할 수 없습니다. 팀 저장소를 선택하세요.',
    INVALID_TARGET: '올바른 GitHub 저장소를 선택하세요.',
    TARGET_CHANGED: '저장소나 연결 계정이 바뀌었습니다. 현황을 다시 가져오세요.',
    ACCESS_DENIED: '저장소 접근 권한과 토큰의 읽기 권한을 확인하세요.',
    RATE_LIMITED: 'GitHub 조회 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
    TIMEOUT: 'GitHub 응답이 지연되고 있습니다. 연결 상태를 확인하고 다시 시도하세요.',
    CANCELLED: '조회가 취소되었습니다. 다시 가져오세요.',
    NETWORK: 'GitHub에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.',
    GITHUB_ERROR: 'GitHub에서 현황을 가져오지 못했습니다. 잠시 후 다시 시도하세요.',
    INVALID_RESPONSE: 'GitHub 응답을 확인하지 못했습니다. 다시 가져오세요.'
  }
  if (language === 'ko') return (code && ko[code]) || '현황을 가져오지 못했습니다. 연결 계정과 팀 저장소를 확인하고 다시 시도하세요.'
  // Electron adds an IPC wrapper around Error.message; display only the stable
  // service message when an error code is available.
  return code ? message.slice(message.indexOf(`[${code}]`) + code.length + 2).trim() : message
}
