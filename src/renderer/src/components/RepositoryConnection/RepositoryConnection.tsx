import type { RepositoryConnectionInspection } from '../../hooks/useRepositoryConnection'
import { getRepositoryConnectionTerms } from '../../i18n/repositoryConnectionTerms'
import type { ProjectCloudTarget, ProjectRemote } from '../../types'
import styles from './RepositoryConnection.module.css'

interface GithubRepository {
  owner: string
  repo: string
}

export type RepositoryConnectionKind =
  | 'no-git' | 'local-only' | 'other-remote' | 'target-unset'
  | 'account-missing' | 'configured' | 'backup-configured' | 'remote-mismatch'

export interface RepositoryConnectionState {
  kind: RepositoryConnectionKind
  repository: string | null
  branch: string | null
  backup: boolean
  backupRemotePending: boolean
  targetReady: boolean
}

interface Props {
  language: 'en' | 'ko'
  inspection: RepositoryConnectionInspection | null
  loading: boolean
  error: string | null
  cloudTarget: ProjectCloudTarget
  accountConnected: boolean
  uploadReady: boolean
  onSetup: () => void
  onConnectAccount: () => void
  onRetry: () => void
}

function repositoryIdentity(owner: string | undefined, repo: string | undefined): GithubRepository | null {
  if (!owner || !repo || !/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(owner) ||
      !/^[a-z0-9._-]{1,100}$/i.test(repo) || repo === '.' || repo === '..') return null
  return { owner, repo }
}

/** Extract display-safe identities only; never render a remote URL or its credentials. */
export function parseGithubRemoteIdentity(remoteUrl: string): GithubRepository | null {
  const value = remoteUrl.trim()
  const scp = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(value)
  if (scp) return repositoryIdentity(scp[1], scp[2].replace(/\.git$/i, ''))

  try {
    const url = new URL(value)
    if (!['https:', 'ssh:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' ||
        url.search || url.hash || (url.port && !(url.protocol === 'ssh:' && url.port === '22'))) return null
    const parts = url.pathname.replace(/\/$/, '').split('/')
    if (parts.length !== 3 || parts[0] !== '') return null
    return repositoryIdentity(parts[1], parts[2].replace(/\.git$/i, ''))
  } catch {
    return null
  }
}

function sameRepository(left: GithubRepository | null, right: GithubRepository | null): boolean {
  return Boolean(left && right && left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repo.toLowerCase() === right.repo.toLowerCase())
}

function remoteRepositories(remote: ProjectRemote) {
  const fetch = parseGithubRemoteIdentity(remote.fetch)
  const push = parseGithubRemoteIdentity(remote.push || remote.fetch)
  return { fetch, push, mismatched: !sameRepository(fetch, push) }
}

function displayRepository(repository: GithubRepository | null): string | null {
  return repository ? `${repository.owner}/${repository.repo}` : null
}

export function getRepositoryConnectionState(
  inspection: RepositoryConnectionInspection,
  cloudTarget: ProjectCloudTarget,
  accountConnected: boolean,
  uploadReady: boolean
): RepositoryConnectionState {
  const backup = cloudTarget.mode === 'backup'
  const target = backup ? cloudTarget.backup : cloudTarget.mode === 'collaboration' ? cloudTarget.collaboration : null
  const targetRepository = repositoryIdentity(target?.repoOwner, target?.repoName)
  const selectedRemote = target && inspection.remotes.find((remote) => remote.name === target.remoteName)
  const selected = selectedRemote ? remoteRepositories(selectedRemote) : null
  const githubRemotes = inspection.remotes.map(remoteRepositories).filter((remote) => remote.fetch || remote.push)
  const firstRepository = selected?.push ?? selected?.fetch ?? githubRemotes[0]?.push ?? githubRemotes[0]?.fetch ?? null
  const rawBranch = cloudTarget.mode === 'collaboration' ? cloudTarget.collaboration?.selectedBranch : null
  const branch = rawBranch && !/[\x00-\x20\x7f:]/.test(rawBranch) ? rawBranch.slice(0, 120) : null
  const targetReady = Boolean(uploadReady && targetRepository && (backup || branch))
  const base: Omit<RepositoryConnectionState, 'kind'> = {
    repository: displayRepository(targetRepository ?? firstRepository),
    branch,
    backup,
    backupRemotePending: backup && !selectedRemote,
    targetReady
  }

  if (!inspection.isGitRepo) return { ...base, kind: 'no-git', repository: null, branch: null }

  // Backup remotes are installed lazily by Upload. Inspect the configured backup,
  // not origin, which may correctly belong to a different team repository.
  if (targetReady && backup && !selectedRemote) {
    return { ...base, kind: accountConnected ? 'backup-configured' : 'account-missing' }
  }

  if (targetRepository && (!selected || selected.mismatched || !sameRepository(selected.push, targetRepository))) {
    return { ...base, kind: 'remote-mismatch' }
  }
  if (selected?.mismatched || (!target && githubRemotes.some((remote) => remote.mismatched))) return { ...base, kind: 'remote-mismatch' }
  if (!githubRemotes.length) return { ...base, kind: inspection.remotes.length ? 'other-remote' : 'local-only', repository: null, branch: null }
  if (!accountConnected) return { ...base, kind: 'account-missing' }
  if (!targetReady) return { ...base, kind: 'target-unset' }
  return { ...base, kind: backup ? 'backup-configured' : 'configured' }
}

export function RepositoryConnection({
  language, inspection, loading, error, cloudTarget, accountConnected, uploadReady,
  onSetup, onConnectAccount, onRetry
}: Props): JSX.Element | null {
  const t = getRepositoryConnectionTerms(language)
  if (!inspection && !loading && !error) return null

  const state = inspection ? getRepositoryConnectionState(inspection, cloudTarget, accountConnected, uploadReady) : null
  const kind = state?.kind
  const positive = !loading && !error && (kind === 'configured' || kind === 'backup-configured')
  let title = t.checking
  let description: string | null = null
  let action: (() => void) | null = null
  let actionLabel = ''

  if (!loading && error) {
    title = t.checkFailed
    description = t.checkFailedDescription
  } else if (!loading && state) {
    const messages: Record<RepositoryConnectionKind, [string, string]> = {
      'no-git': [t.noGit, t.noGitDescription],
      'local-only': [t.localOnly, t.localOnlyDescription],
      'other-remote': [t.otherRemote, t.otherRemoteDescription],
      'target-unset': [t.targetUnset, t.targetUnsetDescription],
      'account-missing': [t.accountMissing, state.backup ? t.backupAccountMissing : state.targetReady ? t.accountMissingDescription : t.accountMissingNoTarget],
      configured: [t.configured, t.configuredDescription],
      'backup-configured': [t.backupConfigured, state.backupRemotePending ? t.backupPendingDescription : t.backupDescription],
      'remote-mismatch': [t.remoteMismatch, t.remoteMismatchDescription]
    }
    title = messages[state.kind][0]
    description = messages[state.kind][1]
    if (state.kind === 'account-missing') {
      action = onConnectAccount
      actionLabel = t.connect
    } else if (state.kind !== 'no-git') {
      action = onSetup
      actionLabel = state.kind === 'remote-mismatch' || positive ? t.reviewSetup : t.setup
    }
  }

  return (
    <section className={`${styles.banner} ${loading ? styles.neutral : positive ? styles.positive : styles.warning}`}
      aria-label={t.regionLabel} aria-busy={loading}>
      <details className={styles.details}>
        <summary className={styles.summary}>
          <span className={styles.indicator} aria-hidden="true" />
          <strong className={styles.title} role="status" title={title}>{title}</strong>
          {!loading && !error && state?.repository && (
            <span className={styles.destination} title={`${state.repository}${state.branch || state.backup ? ` · ${t.branch}: ${state.branch ?? t.currentBranch}` : ''}`}>
              <code>{state.repository}</code>
              {(state.branch || state.backup) && <span> · {state.branch ?? t.currentBranch}</span>}
            </span>
          )}
          {description && <span className={styles.chevron} aria-hidden="true">⌄</span>}
        </summary>
        {description && <div className={styles.explanation}>
          <p className={styles.description}>{description}</p>
          {positive && <p className={styles.note}>{t.configurationOnly}</p>}
        </div>}
      </details>
      {!loading && <div className={styles.actions}>
        {action && <button type="button" className={styles.actionButton} onClick={action}>{actionLabel}</button>}
        <button type="button" className={styles.retryButton} aria-label={t.retry} title={t.retry} onClick={onRetry}>↻</button>
      </div>}
    </section>
  )
}
