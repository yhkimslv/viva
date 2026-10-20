import { useEffect, useRef, useState } from 'react'
import { GitIdentity, validateGitIdentity } from '../../../../shared/gitIdentity'
import { invokeGit } from '../../ipc'
import styles from './GitIdentitySettings.module.css'

export function GitIdentitySettings({ projectId, language = 'en' }: { projectId: string; language?: 'en' | 'ko' }): JSX.Element {
  const ko = language === 'ko'
  const [identity, setIdentity] = useState<GitIdentity | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const pending = useRef(false)
  const messages = {
    name: ko ? '이름을 입력하세요. 200자 이내로, 꺾쇠나 제어 문자는 사용할 수 없습니다.' : 'Enter a name of up to 200 characters without angle brackets or control characters.',
    email: ko ? '공백 없이 유효한 이메일 주소를 입력하세요.' : 'Enter an email address without spaces.',
    load: ko ? '작성자 정보를 읽지 못했습니다. 프로젝트가 Git 저장소인지 확인하고 다시 불러오세요.' : 'Could not read the author settings. Check that this is a Git repository and reload.',
    save: ko ? '저장하지 못했습니다. 현재 설정을 다시 불러와 확인한 뒤 재시도하세요.' : 'Could not finish saving. Reload the current settings to check them, then try again.'
  }
  const source = (scope: GitIdentity['name']['scope']): string => scope === 'local' || scope === 'worktree'
    ? ko ? '이 프로젝트 설정' : 'Project setting'
    : scope ? ko ? '컴퓨터에서 상속한 설정' : 'Inherited computer setting'
      : ko ? '미설정' : 'Not configured'

  useEffect(() => {
    const request = ++generation.current
    pending.current = false
    setIdentity(null); setName(''); setEmail(''); setError(null); setSaved(false); setLoading(true)
    void invokeGit<GitIdentity>('git:identity:get', projectId).then((next) => {
      if (generation.current !== request) return
      setIdentity(next); setName(next.name.value ?? ''); setEmail(next.email.value ?? '')
    }).catch(() => {
      if (generation.current === request) setError(messages.load)
    }).finally(() => { if (generation.current === request) setLoading(false) })
    return () => { generation.current += 1 }
  }, [projectId, reload, language])

  const save = async (): Promise<void> => {
    if (pending.current || !identity) return
    const input = { name: name.trim(), email: email.trim() }
    const invalid = validateGitIdentity(input)
    if (invalid) { setError(messages[invalid]); setSaved(false); return }
    const request = generation.current
    pending.current = true
    setLoading(true); setError(null); setSaved(false)
    try {
      const next = await invokeGit<GitIdentity>('git:identity:set', projectId, input)
      if (generation.current !== request) return
      setIdentity(next); setName(next.name.value ?? ''); setEmail(next.email.value ?? ''); setSaved(true)
    } catch {
      if (generation.current === request) setError(messages.save)
    } finally {
      if (generation.current === request) { pending.current = false; setLoading(false) }
    }
  }

  return <section className={styles.section} aria-labelledby="git-identity-title">
    <h3 id="git-identity-title">{ko ? '커밋 작성자' : 'Commit author'}</h3>
    <p className={styles.copy}>{ko ? '이 이름과 이메일은 앞으로 만드는 커밋에 기록되며, 업로드하면 저장소를 볼 수 있는 사람에게 표시됩니다. GitHub의 비공개 이메일도 사용할 수 있습니다.' : 'Your name and email are recorded in future commits and visible to people who can access the repository after upload. You can use your GitHub private email.'}</p>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>{ko ? '작성자 이름' : 'Author name'}<input value={name} onChange={(event) => { setName(event.target.value); setSaved(false) }} disabled={loading || !identity} maxLength={200} autoComplete="name" /></label>
      <p className={styles.source}>{source(identity?.name.scope ?? null)}</p>
      <label>{ko ? '작성자 이메일' : 'Author email'}<input value={email} onChange={(event) => { setEmail(event.target.value); setSaved(false) }} disabled={loading || !identity} maxLength={254} inputMode="email" autoComplete="email" /></label>
      <p className={styles.source}>{source(identity?.email.scope ?? null)}</p>
      <p className={styles.copy}>{ko ? '저장 버튼을 누르면 이 프로젝트에만 적용합니다. 컴퓨터의 공통 Git 설정은 바꾸지 않습니다.' : 'Saving applies only to this project. Your computer’s shared Git settings stay unchanged.'}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {saved && <p className={styles.success} role="status">{ko ? '이 프로젝트의 작성자 정보를 저장했습니다.' : 'Author settings saved for this project.'}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={loading} onClick={() => setReload((value) => value + 1)}>{ko ? '다시 불러오기' : 'Reload settings'}</button>
        <button type="submit" disabled={loading || !identity}>{loading ? ko ? '확인 중…' : 'Working…' : ko ? '이 프로젝트에 저장' : 'Save for this project'}</button>
      </div>
    </form>
  </section>
}
