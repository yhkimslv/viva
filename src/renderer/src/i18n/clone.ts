import type { CloneErrorCode, ClonePhase } from '../../../shared/clone'

export function getCloneTerms(language: 'en' | 'ko' = 'en') {
  const ko = language === 'ko'
  const errors: Record<CloneErrorCode, string> = ko ? {
    'invalid-url': 'https://github.com/소유자/저장소 형식의 GitHub HTTPS 주소를 입력하세요.',
    'invalid-name': '새 폴더 이름을 입력하세요. 점으로 시작하거나 경로·특수 문자를 포함할 수 없습니다.',
    'invalid-parent': '실제로 존재하는 저장 위치를 선택하세요. 바로가기나 심볼릭 링크는 사용할 수 없습니다.',
    'destination-exists': '같은 이름의 폴더나 파일이 있습니다. 다른 새 폴더 이름을 입력하세요.',
    'destination-changed': '받는 동안 저장 위치가 변경됐습니다. 위치와 새 폴더 이름을 다시 선택하세요.',
    busy: '이미 프로젝트를 받고 있습니다. 완료되거나 취소된 뒤 다시 시도하세요.',
    cancelled: '가져오기를 취소했습니다. 기존 파일은 그대로 유지됩니다.',
    'git-unavailable': 'Git을 찾을 수 없습니다. Git을 설치한 뒤 VIVA를 다시 시작하세요.',
    authentication: '저장소 주소와 접근 권한을 확인하세요. 비공개 저장소는 GitHub에 연결한 뒤 다시 시도하세요.',
    network: 'GitHub에 연결하지 못했습니다. 인터넷 연결과 저장소의 현재 HTTPS 주소를 확인하세요.',
    'disk-space': '저장 공간이 부족합니다. 공간을 확보하거나 다른 위치를 선택하세요.',
    permission: '이 위치에 쓸 수 없습니다. 쓰기 권한이 있는 폴더를 선택하세요.',
    registration: '가져오기는 끝났지만 VIVA에 등록하지 못했습니다. 아래 폴더를 기존 프로젝트로 연결하세요.',
    publication: '받은 파일을 저장 위치에 안전하게 옮기지 못했습니다. 다른 새 폴더 이름으로 다시 시도하세요.',
    failed: '프로젝트를 가져오지 못했습니다. 저장소 주소와 저장 위치를 확인한 뒤 다시 시도하세요.'
  } : {
    'invalid-url': 'Enter a GitHub HTTPS URL such as https://github.com/owner/repository.',
    'invalid-name': 'Enter a new folder name without a leading dot, path separators, or special characters.',
    'invalid-parent': 'Choose an existing folder. Shortcuts and symbolic links are not supported.',
    'destination-exists': 'A file or folder with this name already exists. Choose a different new folder name.',
    'destination-changed': 'The destination changed during the download. Choose the location and new folder name again.',
    busy: 'A clone is already running. Wait for it to finish or cancel before trying again.',
    cancelled: 'Clone cancelled. Existing files are preserved.',
    'git-unavailable': 'Git was not found. Install Git, then restart VIVA.',
    authentication: 'Check the repository URL and access permissions. For a private repository, connect GitHub and try again.',
    network: 'Could not connect to GitHub. Check your connection and the current HTTPS repository URL.',
    'disk-space': 'Not enough disk space. Free some space or choose another location.',
    permission: 'Cannot write to this location. Choose a folder you can write to.',
    registration: 'The repository was downloaded, but VIVA could not register it. Link the folder below as an existing project.',
    publication: 'The downloaded files could not be placed safely. Try again with a different new folder name.',
    failed: 'Could not clone the project. Check the repository URL and destination, then try again.'
  }
  const phases: Record<ClonePhase, string> = ko ? {
    preparing: '저장 위치 준비 중', receiving: '프로젝트 받는 중', resolving: '변경 기록 정리 중',
    checkout: '파일 준비 중', publishing: '받은 파일을 새 폴더에 옮기는 중', registering: 'VIVA에 프로젝트 등록 중'
  } : {
    preparing: 'Preparing destination', receiving: 'Receiving project', resolving: 'Resolving history',
    checkout: 'Preparing files', publishing: 'Placing files in the new folder', registering: 'Adding project to VIVA'
  }
  return {
    title: ko ? 'GitHub 프로젝트 가져오기' : 'Clone a GitHub project',
    intro: ko ? '팀 저장소를 새 폴더로 받아 바로 시작하세요.' : 'Download your team repository into a new folder and start working.',
    url: ko ? 'GitHub 저장소 HTTPS 주소' : 'GitHub repository HTTPS URL',
    urlHint: ko ? '공개 저장소는 로그인 없이 가능합니다. 비공개 저장소는 설정에서 GitHub에 먼저 연결하세요.' : 'Public repositories need no login. For private repositories, connect GitHub in Settings first.',
    parent: ko ? '저장 위치' : 'Save inside',
    chooseParent: ko ? '폴더 선택' : 'Choose folder',
    noParent: ko ? '프로젝트를 저장할 상위 폴더를 선택하세요.' : 'Choose the parent folder for your project.',
    folderName: ko ? '새 프로젝트 폴더 이름' : 'New project folder name',
    destination: ko ? '받을 위치' : 'Destination',
    note: ko ? '기존 폴더를 덮어쓰지 않습니다. 하위 모듈은 자동으로 받지 않습니다.' : 'Existing folders are preserved. Submodules are not downloaded automatically.',
    submit: ko ? '가져오고 열기' : 'Clone and open',
    cancel: ko ? '취소' : 'Cancel',
    close: ko ? '닫기' : 'Close',
    cancelling: ko ? '취소 중…' : 'Cancelling…',
    starting: ko ? '시작 중…' : 'Starting…',
    recoveryHint: ko ? '아래 폴더는 보호를 위해 남겨 두었습니다. 불완전한 파일이 있을 수 있으니 확인 후 직접 정리하거나 다른 새 폴더 이름을 사용하세요.' : 'The folder below was preserved for safety and may contain incomplete files. Review it before removing it, or use another new folder name.',
    errors, phases
  }
}
