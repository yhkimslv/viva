import { workflowTerms, WorkflowLanguage } from '../../i18n/workflowTerms'
import styles from './WorkflowGuide.module.css'

export interface WorkflowGuideProps {
  /** Display language; pass the app's current language preference. */
  language: WorkflowLanguage
}

/** Compact beginner guidance. Details stay collapsed until the user opens them. */
export function WorkflowGuide({ language }: WorkflowGuideProps): JSX.Element {
  const t = workflowTerms[language]

  return (
    <section className={styles.guide} aria-label={t.guideLabel}>
      <details>
        <summary className={styles.summary} aria-label={t.detailsLabel}>
          <span className={styles.hints}>
          <span className={styles.hint}>
            <strong>{t.fileClickLabel}</strong>
            <span className={styles.hintArrow} aria-hidden="true">→</span>
            <span>{t.fileClickCopy}</span>
          </span>
          <span className={styles.hint}>
            <strong>{t.checkboxLabel}</strong>
            <span className={styles.hintArrow} aria-hidden="true">→</span>
            <span>{t.checkboxCopy}</span>
          </span>
          </span>
          <span className={styles.toggle}>{t.detailsLabel}<span aria-hidden="true"> ▾</span></span>
        </summary>
        <div className={styles.content}>
          <ol className={styles.steps}>
            {t.steps.map((step, index) => (
              <li key={step.command} className={styles.step}>
                <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <div className={styles.stepContent}>
                  <div className={styles.stepHeading}>
                    <strong>{step.title}</strong>
                    <code>{step.command}</code>
                  </div>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className={styles.localNote}>{t.localOnlyNote}</p>
        </div>
      </details>
    </section>
  )
}
