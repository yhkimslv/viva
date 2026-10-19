import styles from './AIConsentDialog.module.css'
import { useTerms } from '../../hooks/useTerms'

interface Props {
  onAccept: () => void
  onDecline: () => void
}

export function AIConsentDialog({ onAccept, onDecline }: Props): JSX.Element {
  const t = useTerms()
  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ai-consent-title">
        <h2 id="ai-consent-title" className={styles.title}>
          {t.aiConsentTitle}
        </h2>
        <p className={styles.body}>
          {t.aiDataSharingDescription}
        </p>
        <div className={styles.actions}>
          <button className={styles.secondaryBtn} onClick={onDecline}>
            {t.aiConsentDecline}
          </button>
          <button className={styles.primaryBtn} onClick={onAccept}>
            {t.aiConsentAccept}
          </button>
        </div>
      </div>
    </div>
  )
}
