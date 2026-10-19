import { useState } from 'react'
import type { DashboardPullRequest } from '../../../../shared/dashboard'
import { useLeadDashboard } from '../../hooks/useLeadDashboard'
import { dashboardErrorMessage, dashboardTerms } from '../../i18n/dashboardTerms'
import styles from './LeadDashboard.module.css'

interface Props {
  projectId: string | null
  language: 'en' | 'ko'
  connected: boolean
  repositoryReady: boolean
  contextKey: string
  onConnect: () => void
  onSetup: () => void
  onClose: () => void
}

export function githubLink(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && !parsed.username && !parsed.password && !parsed.port
      ? parsed.toString() : undefined
  } catch { return undefined }
}

function isAwaiting(pr: DashboardPullRequest): boolean {
  return !pr.draft && (pr.reviewRequested || pr.reviewDecision === 'review_required')
}

export function LeadDashboard({
  projectId, language, connected, repositoryReady, contextKey, onConnect, onSetup, onClose
}: Props): JSX.Element {
  const t = dashboardTerms(language)
  const { snapshot, loading, error, refresh } = useLeadDashboard(projectId, connected && repositoryReady, contextKey)
  const [filter, setFilter] = useState<'all' | 'review' | 'requested' | 'failing'>('all')
  const locale = language === 'ko' ? 'ko-KR' : 'en-US'
  const formatDate = (date: string): string => Number.isNaN(Date.parse(date)) ? '—' : new Date(date).toLocaleString(locale)
  const stateText = (state: string): string => {
    if (state === 'failing') return t.failingState
    return (t as Record<string, string>)[state] ?? t.unknown
  }
  const badgeClass = (state: string): string =>
    ['failure', 'failing', 'changes_requested', 'timed_out', 'action_required'].includes(state) ? styles.danger
      : ['success', 'passing', 'approved'].includes(state) ? styles.good : styles.neutral
  const prs = snapshot?.pullRequests ?? []
  const reviewUnknown = prs.filter((pr) => !pr.draft && !pr.reviewRequested && pr.reviewDecision === 'unknown').length
  const checksUnknown = prs.filter((pr) => pr.checks.state === 'unknown').length
  const countText = (count: number, coverage?: 'complete' | 'partial' | 'unavailable'): string =>
    coverage === 'unavailable' ? '—' : `${coverage === 'partial' ? '≥ ' : ''}${count}`
  const displayedPrs = prs.filter((pr) => filter === 'all' ||
    (filter === 'review' && isAwaiting(pr)) || (filter === 'requested' && pr.reviewRequested) ||
    (filter === 'failing' && pr.checks.state === 'failing'))

  const emptyState = !projectId
    ? { title: t.selectTitle, description: t.selectDescription }
    : !connected ? { title: t.connectTitle, description: t.connectDescription, action: t.connect, onAction: onConnect }
      : !repositoryReady ? { title: t.setupTitle, description: t.setupDescription, action: t.setup, onAction: onSetup }
        : null

  return (
    <section className={styles.dashboard} aria-labelledby="lead-dashboard-title">
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>VIVA / TEAM</p><h1 id="lead-dashboard-title">{t.title}</h1><p className={styles.subtitle}>{t.subtitle}</p></div>
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onClose}>{t.back}</button>
          {!emptyState && <button className={styles.primary} onClick={() => void refresh()} disabled={loading}>{loading ? t.refreshing : t.refresh}</button>}
        </div>
      </div>

      {emptyState ? <div className={styles.emptyState}>
        <div className={styles.emptyIcon} aria-hidden="true">⑂</div><h2>{emptyState.title}</h2><p>{emptyState.description}</p>
        {emptyState.action && <button className={styles.primary} onClick={emptyState.onAction}>{emptyState.action}</button>}
      </div> : <>
        {error && <div className={styles.error} role="alert"><strong>{snapshot ? t.stale : t.loadFailed}</strong><p>{dashboardErrorMessage(error, language)}</p><div className={styles.actions}><button className={styles.secondary} onClick={onSetup}>{t.setup}</button><button className={styles.secondary} onClick={onConnect}>{t.connect}</button></div></div>}
        {loading && !snapshot && <div className={styles.loading} role="status"><span className={styles.spinner} aria-hidden="true" />{t.loading}</div>}
        {snapshot && <div aria-busy={loading}>
          <div className={styles.repository}>
            <div><span className={styles.repoLabel}>{t.repository}</span><a href={githubLink(snapshot.repository.url)} target="_blank" rel="noreferrer noopener">{snapshot.repository.owner}/{snapshot.repository.name} ↗</a><span className={styles.baseBranch}>{snapshot.repository.defaultBranch}</span></div>
            <p>{t.viewer} {snapshot.viewerLogin} <span>·</span> {t.updated} {formatDate(snapshot.fetchedAt)}</p>
          </div>
          <div className={styles.metrics}>
            <button aria-label={`${t.openPrs}: ${countText(prs.length, snapshot.coverage?.pullRequests)}`} aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className={styles.metric}><span>{t.openPrs}</span><strong>{countText(prs.length, snapshot.coverage?.pullRequests)}</strong></button>
            <button aria-label={`${t.awaiting}: ${countText(prs.filter(isAwaiting).length, snapshot.coverage?.pullRequests)}`} aria-pressed={filter === 'review'} onClick={() => setFilter('review')} className={styles.metric}><span>{t.awaiting}</span><strong>{countText(prs.filter(isAwaiting).length, snapshot.coverage?.pullRequests)}</strong>{reviewUnknown > 0 && <span>{t.unknown} · {reviewUnknown}</span>}</button>
            <button aria-label={`${t.failing}: ${countText(prs.filter((pr) => pr.checks.state === 'failing').length, snapshot.coverage?.pullRequests)}`} aria-pressed={filter === 'failing'} onClick={() => setFilter('failing')} className={`${styles.metric} ${styles.failureMetric}`}><span>{t.failing}</span><strong>{countText(prs.filter((pr) => pr.checks.state === 'failing').length, snapshot.coverage?.pullRequests)}</strong>{checksUnknown > 0 && <span>{t.unknown} · {checksUnknown}</span>}</button>
            <div className={styles.metric}><span>{t.assigned}</span><strong>{countText(snapshot.issues.length, snapshot.coverage?.issues)}</strong>{snapshot.coverage?.issues === 'unavailable' && <span>{t.unavailable}</span>}</div>
          </div>
          <div className={styles.columns}>
            <section className={styles.panel} aria-labelledby="dashboard-pr-title">
              <div className={styles.panelHeading}><h2 id="dashboard-pr-title">{t.prs}</h2><span className={styles.count}>{displayedPrs.length}</span></div>
              <div className={styles.filters} aria-label={t.prs}>
                {(['all', 'requested', 'failing'] as const).map((value) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? t.all : value === 'requested' ? t.requested : t.checksFailed}</button>)}
              </div>
              {displayedPrs.length === 0 ? <p className={styles.emptyCopy}>{t.prEmpty}</p> : <ul className={styles.list}>
                {displayedPrs.map((pr) => <li key={pr.number} className={styles.prItem}>
                  <div className={styles.itemHeading}><span className={styles.number}>#{pr.number}</span><a href={githubLink(pr.url)} target="_blank" rel="noreferrer noopener">{pr.title} ↗</a></div>
                  <p className={styles.meta}>{pr.author} <span>·</span> <span className={styles.branch}>{pr.branch} → {pr.baseBranch}</span></p>
                  <div className={styles.badges}>
                    {pr.draft && <span className={`${styles.badge} ${styles.neutral}`}>{t.draft}</span>}
                    <span className={`${styles.badge} ${badgeClass(pr.reviewDecision)}`}>{stateText(pr.reviewDecision)}</span>
                    <span className={`${styles.badge} ${badgeClass(pr.checks.state)}`}>{stateText(pr.checks.state)}{pr.checks.total > 0 && ` · ${pr.checks.completed}/${pr.checks.total}`}</span>
                    {pr.reviewRequested && <span className={`${styles.badge} ${styles.requested}`}>{t.accountReview}</span>}
                  </div>
                </li>)}
              </ul>}
            </section>
            <section className={styles.panel} aria-labelledby="dashboard-runs-title">
              <div className={styles.panelHeading}><h2 id="dashboard-runs-title">{t.workflows}</h2></div>
              {snapshot.recentRuns.length === 0 ? <p className={styles.emptyCopy}>{snapshot.coverage?.workflows === 'unavailable' ? t.runUnavailable : t.runEmpty}</p> : <ul className={styles.list}>
                {snapshot.recentRuns.map((run) => <li key={run.id} className={styles.runItem}>
                  <div className={styles.runTitle}><span className={`${styles.statusDot} ${badgeClass(run.conclusion ?? run.status)}`} aria-hidden="true" /><a href={githubLink(run.url)} target="_blank" rel="noreferrer noopener">{run.name} ↗</a></div>
                  <p className={styles.meta}>{run.branch} <span>·</span> {stateText(run.conclusion ?? run.status)}</p><time className={styles.runDate} dateTime={run.updatedAt}>{formatDate(run.updatedAt)}</time>
                </li>)}
              </ul>}
            </section>
          </div>
          <section className={`${styles.panel} ${styles.issuePanel}`} aria-labelledby="dashboard-issues-title">
            <div className={styles.panelHeading}><div><h2 id="dashboard-issues-title">{t.issueTitle}</h2><p className={styles.meta}>{t.issueCopy}</p></div><span className={styles.count}>{countText(snapshot.issues.length, snapshot.coverage?.issues)}</span></div>
            {snapshot.issues.length === 0 ? <p className={styles.emptyCopy}>{snapshot.coverage?.issues === 'unavailable' ? t.issueUnavailable : t.issueEmpty}</p> : <ul className={styles.issueList}>
              {snapshot.issues.map((issue) => <li key={issue.number} className={styles.issueItem}>
                <div><span className={styles.number}>#{issue.number}</span><a href={githubLink(issue.url)} target="_blank" rel="noreferrer noopener">{issue.title} ↗</a><div className={styles.labels}>{issue.labels.map((label) => <span key={label}>{label}</span>)}</div></div>
                <span className={styles.assignees}>{issue.assignees.join(', ') || t.unassigned}</span>
              </li>)}
            </ul>}
          </section>
          {snapshot.warnings.length > 0 && <details className={styles.warnings} open={snapshot.warnings.length <= 3}><summary>{t.warnings} · {snapshot.warnings.length}</summary><ul>{snapshot.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          <p className={styles.readOnly}>{t.readOnly}</p>
        </div>}
      </>}
    </section>
  )
}
