import { useState } from 'react'
import { usePreferences } from '../../hooks/usePreferences'
import { invokeDb } from '../../ipc'
import styles from './GitNotInstalled.module.css'

const downloads = {
  windows: 'https://gitforwindows.org/',
  mac: 'https://developer.apple.com/xcode/resources/'
} as const

const copy = {
  en: {
    title: 'Install Git to get started',
    description:
      'VIVA needs Git to save and share project versions. You do not need Node.js or npm to use this app.',
    windowsLink: 'Open Git for Windows',
    windowsSteps: [
      'Download the installer from Git for Windows, then open the downloaded .exe file.',
      'Follow the installation screens with the default options.',
      'Quit and reopen VIVA after installation so Windows can find Git.'
    ],
    macLink: 'Open Apple Additional tools',
    macSteps: [
      'Under Additional tools, select View downloads and sign in to your Apple Account. A paid developer membership is not required.',
      'Download Command Line Tools for Xcode that supports your macOS version.',
      'Open the downloaded .dmg, then open the .pkg installer and follow its screens.'
    ],
    note: 'No terminal commands are needed. After installing, check again below.',
    retry: 'Check for Git again',
    openError: 'Could not open your browser. Open this address in your browser:'
  },
  ko: {
    title: 'Git을 설치하고 시작하세요',
    description:
      'VIVA에서 프로젝트 버전을 저장하고 공유하려면 Git이 필요합니다. 앱을 사용하는 데 Node.js나 npm은 필요하지 않습니다.',
    windowsLink: 'Git for Windows 열기',
    windowsSteps: [
      'Git for Windows에서 설치 파일을 내려받고, 내려받은 .exe 파일을 여세요.',
      '기본 옵션을 유지한 채 설치 화면의 안내를 따라 진행하세요.',
      'Windows가 Git을 찾을 수 있도록 설치 후 VIVA를 종료하고 다시 실행하세요.'
    ],
    macLink: 'Apple Additional tools 열기',
    macSteps: [
      'Additional tools에서 View downloads를 선택하고 Apple 계정으로 로그인하세요. 유료 개발자 멤버십은 필요하지 않습니다.',
      '사용 중인 macOS 버전을 지원하는 Command Line Tools for Xcode를 내려받으세요.',
      '내려받은 .dmg를 열고, 안에 있는 .pkg 설치 파일을 열어 화면의 안내를 따르세요.'
    ],
    note: '터미널 명령어를 입력할 필요가 없습니다. 설치를 마치면 아래에서 다시 확인하세요.',
    retry: 'Git 설치 다시 확인',
    openError: '브라우저를 열지 못했습니다. 브라우저에서 다음 주소를 여세요:'
  }
}

interface Props {
  onRetry: () => void
}

export function GitNotInstalled({ onRetry }: Props): JSX.Element {
  const { preferences } = usePreferences()
  const text = copy[preferences.language === 'ko' ? 'ko' : 'en']
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const openDownload = (platform: keyof typeof downloads): void => {
    setFailedUrl(null)
    const url = downloads[platform]
    invokeDb('shell:openExternal', url).catch(() => setFailedUrl(url))
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.icon} aria-hidden="true">⚙️</div>
        <h1 className={styles.title}>{text.title}</h1>
        <p className={styles.description}>{text.description}</p>

        <div className={styles.platforms}>
          <section className={styles.platform} aria-labelledby="git-windows-title">
            <h2 id="git-windows-title" className={styles.platformTitle}>Windows</h2>
            <button className={styles.link} onClick={() => openDownload('windows')}>
              {text.windowsLink}
            </button>
            <ol className={styles.steps}>
              {text.windowsSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </section>
          <section className={styles.platform} aria-labelledby="git-mac-title">
            <h2 id="git-mac-title" className={styles.platformTitle}>macOS</h2>
            <button className={styles.link} onClick={() => openDownload('mac')}>
              {text.macLink}
            </button>
            <ol className={styles.steps}>
              {text.macSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </section>
        </div>

        <p className={styles.note}>{text.note}</p>
        {failedUrl && <p className={styles.error} role="alert">{text.openError} {failedUrl}</p>}
        <button className={styles.retryBtn} onClick={onRetry}>
          {text.retry}
        </button>
      </div>
    </div>
  )
}
