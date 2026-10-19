import { CloneProjectState } from '../../hooks/useCloneProject'
import { getCloneTerms } from '../../i18n/clone'
import styles from './CloneProjectDialog.module.css'

type Props = Omit<CloneProjectState, 'open'>

export function CloneProjectDialog({
  isOpen, language, repositoryUrl, setRepositoryUrl, directoryName, setDirectoryName,
  parentPath, chooseParent, loading, cancelling, progress, error, recoveryPath, recoveryHint,
  close, submit, cancel
}: Props): JSX.Element | null {
  if (!isOpen) return null
  const t = getCloneTerms(language)
  const destination = parentPath ? `${parentPath.replace(/[\\/]$/, '')}/${directoryName}` : null
  return (
    <div className={styles.backdrop}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="clone-title">
        <div className={styles.header}>
          <h2 id="clone-title">{t.title}</h2>
          <button className={styles.close} onClick={close} disabled={loading} aria-label={t.close}>×</button>
        </div>
        <p className={styles.copy}>{t.intro}</p>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <label className={styles.field}>
            <span>{t.url}</span>
            <input autoFocus type="url" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)}
              placeholder="https://github.com/team/project" disabled={loading} required spellCheck={false} />
          </label>
          <p className={styles.hint}>{t.urlHint}</p>
          <div className={styles.field}>
            <span>{t.parent}</span>
            <div className={styles.picker}>
              <span className={styles.path}>{parentPath || t.noParent}</span>
              <button type="button" className={styles.secondary} onClick={() => void chooseParent()} disabled={loading}>{t.chooseParent}</button>
            </div>
          </div>
          <label className={styles.field}>
            <span>{t.folderName}</span>
            <input value={directoryName} onChange={(event) => setDirectoryName(event.target.value)} disabled={loading} maxLength={100} required />
          </label>
          {destination && <p className={styles.hint}>{t.destination}: <code>{destination}</code></p>}
          <p className={styles.hint}>{t.note}</p>
          {error && <div className={styles.error} role="alert">{error}{recoveryPath && <><code className={styles.recovery}>{recoveryPath}</code>{recoveryHint && <p>{recoveryHint}</p>}</>}</div>}
          {loading && <div className={styles.progress} role="status" aria-live="polite">
            <span>{cancelling ? t.cancelling : progress ? t.phases[progress.phase] : t.starting}{!cancelling && progress?.percent !== undefined ? ` · ${progress.percent}%` : ''}</span>
            <progress aria-label={progress ? t.phases[progress.phase] : t.starting} max={100} value={progress?.percent} />
          </div>}
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => void cancel()} disabled={cancelling}>{t.cancel}</button>
            <button type="submit" className={styles.primary} disabled={loading || !repositoryUrl.trim() || !directoryName.trim() || !parentPath}>{t.submit}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
