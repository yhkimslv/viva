import type { DashboardPullRequest, DashboardSnapshot } from '../../shared/dashboard'

const API = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const MAX_PRS = 30
const MAX_ISSUES = 100
const MAX_RUNS = 20
const DETAIL_PAGES = 2

interface GithubUser { login?: string }
interface GithubRepository { owner?: GithubUser; name?: string; default_branch?: string }
interface GithubPullRequest {
  number: number; title: string; user?: GithubUser; draft?: boolean; updated_at: string
  head?: { sha?: string; ref?: string }; base?: { ref?: string }
  assignees?: GithubUser[]; requested_reviewers?: GithubUser[]; requested_teams?: { slug?: string }[]
}
interface GithubIssue {
  number: number; title: string; assignees?: GithubUser[]; labels?: (string | { name?: string })[]
  updated_at: string; pull_request?: unknown
}
interface GithubWorkflowRun {
  id: number; name?: string; status?: string; conclusion?: string | null; head_branch?: string; updated_at: string
}
export interface GithubReview {
  id: number; user?: GithubUser; state: string; commit_id?: string; submitted_at?: string | null
}
export interface GithubCheckRun { id: number; name?: string; status: string; conclusion: string | null }
export interface GithubCommitStatus { id: number; context: string; state: string }
interface Page<T> { items: T[]; truncated: boolean }

export class DashboardError extends Error {
  constructor(readonly code: string, message: string, readonly fatal = false) {
    super(message)
    this.name = 'DashboardError'
  }
}

export function validateDashboardRepository(owner: string, repo: string): void {
  if (!/^[a-z\d][a-z\d-]{0,38}$/i.test(owner) ||
      !/^[a-z\d_.-]{1,100}$/i.test(repo) || repo === '.' || repo === '..') {
    throw new DashboardError('INVALID_TARGET', 'Choose a valid GitHub team repository in Upload to Cloud.', true)
  }
}

/** Comments do not revoke an approval. A dismissed review does, as does a later decision. */
export function summarizeDashboardReviews(reviews: GithubReview[], headSha: string): DashboardPullRequest['reviewDecision'] {
  const latest = new Map<string, GithubReview>()
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (!review.user?.login || !['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) continue
    latest.set(review.user.login.toLowerCase(), review)
  }
  if ([...latest.values()].some((review) => review.state === 'CHANGES_REQUESTED')) return 'changes_requested'
  // Be conservative after a push: an approval of an older commit must not look current.
  if ([...latest.values()].some((review) => review.state === 'APPROVED' && review.commit_id === headSha)) return 'approved'
  return 'review_required'
}

export function summarizeDashboardChecks(
  checks: GithubCheckRun[], statuses: GithubCommitStatus[], complete = true
): DashboardPullRequest['checks'] {
  const latestStatuses = new Map<string, GithubCommitStatus>()
  for (const status of statuses) {
    const old = latestStatuses.get(status.context)
    if (!old || old.id < status.id) latestStatuses.set(status.context, status)
  }
  const currentStatuses = [...latestStatuses.values()]
  const total = checks.length + currentStatuses.length
  const completed = checks.filter((check) => check.status === 'completed').length +
    currentStatuses.filter((status) => status.state !== 'pending').length
  const failing = checks.some((check) => check.status === 'completed' &&
    ['failure', 'cancelled', 'timed_out', 'action_required', 'stale'].includes(check.conclusion ?? '')) ||
    currentStatuses.some((status) => ['failure', 'error'].includes(status.state))
  if (failing) return { state: 'failing', total, completed }
  if (!complete) return { state: 'unknown', total, completed }
  if (total === 0) return { state: 'none', total, completed }
  const unknown = checks.some((check) => check.status === 'completed' &&
    !['success', 'neutral', 'skipped'].includes(check.conclusion ?? '')) ||
    currentStatuses.some((status) => !['success', 'pending'].includes(status.state))
  if (unknown) return { state: 'unknown', total, completed }
  return { state: completed === total ? 'passing' : 'pending', total, completed }
}

function logins(users?: GithubUser[]): string[] {
  return (users ?? []).flatMap((user) => user.login ? [user.login] : [])
}

async function mapBounded<T, U>(items: T[], count: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }))
  return results
}

export function createDashboardService(options: {
  fetch?: typeof fetch; requestTimeoutMs?: number; totalTimeoutMs?: number
} = {}) {
  const requestFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))

  return {
    async getSnapshot(input: { token: string; owner: string; repo: string; signal?: AbortSignal }): Promise<DashboardSnapshot> {
      validateDashboardRepository(input.owner, input.repo)
      if (!input.token.trim()) throw new DashboardError('NOT_CONNECTED', 'Connect GitHub in Settings before opening the lead dashboard.', true)
      const controller = new AbortController()
      const onAbort = (): void => { controller.abort('cancelled') }
      input.signal?.addEventListener('abort', onAbort, { once: true })
      if (input.signal?.aborted) onAbort()
      const totalTimeout = setTimeout(() => controller.abort('timeout'), options.totalTimeoutMs ?? 45_000)
      const warnings: string[] = []
      const warn = (message: string): void => { if (!warnings.includes(message)) warnings.push(message) }
      const root = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`
      const web = `https://github.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`

      const checkAbort = (): void => {
        if (controller.signal.aborted) throw new DashboardError(
          controller.signal.reason === 'timeout' ? 'TIMEOUT' : 'CANCELLED',
          controller.signal.reason === 'timeout'
            ? 'GitHub dashboard took too long. Check your connection and refresh.'
            : 'Dashboard request cancelled.', true
        )
      }

      async function request<T>(path: string): Promise<{ data: T; next: boolean }> {
        checkAbort()
        const requestController = new AbortController()
        const abortRequest = (): void => requestController.abort()
        controller.signal.addEventListener('abort', abortRequest, { once: true })
        const timeout = setTimeout(() => requestController.abort('timeout'), options.requestTimeoutMs ?? 10_000)
        try {
          const response = await requestFetch(`${API}${path}`, {
            method: 'GET', redirect: 'error', signal: requestController.signal,
            headers: {
              Accept: 'application/vnd.github+json', Authorization: `Bearer ${input.token}`,
              'X-GitHub-Api-Version': API_VERSION
            }
          })
          checkAbort()
          if (!response.ok) {
            if (response.status === 401) throw new DashboardError('NOT_CONNECTED', 'GitHub login expired. Reconnect GitHub in Settings.', true)
            const remaining = response.headers.get('x-ratelimit-remaining')
            // Secondary limits can omit Retry-After. Inspect only the classification,
            // never forward the upstream body (which can contain sensitive details).
            const errorBody = await response.json().catch(() => null) as { message?: unknown } | null
            const secondaryLimit = response.status === 403 && typeof errorBody?.message === 'string' &&
              /secondary rate limit|abuse detection/i.test(errorBody.message)
            if (response.status === 429 || response.headers.has('retry-after') ||
                (response.status === 403 && remaining === '0') || secondaryLimit) {
              throw new DashboardError('RATE_LIMITED', 'GitHub rate limit reached. Wait before refreshing the dashboard.', true)
            }
            if (response.status === 403 || response.status === 404) {
              throw new DashboardError('ACCESS_DENIED', 'GitHub could not provide this data. Check repository access and token read permissions.')
            }
            throw new DashboardError('GITHUB_ERROR', 'GitHub could not provide this data. Try refreshing shortly.')
          }
          const data = await response.json() as T
          checkAbort()
          return { data, next: /rel="next"/.test(response.headers.get('link') ?? '') }
        } catch (error) {
          checkAbort()
          if (error instanceof DashboardError) throw error
          throw new DashboardError(
            requestController.signal.aborted ? 'TIMEOUT' : 'NETWORK',
            requestController.signal.aborted
              ? 'GitHub request timed out. Check your connection and refresh.'
              : 'Could not reach GitHub. Check your connection and refresh.'
          )
        } finally {
          clearTimeout(timeout)
          controller.signal.removeEventListener('abort', abortRequest)
        }
      }

      async function pages<T>(path: string, perPage: number, maxPages: number, key?: string): Promise<Page<T>> {
        const items: T[] = []
        for (let page = 1; page <= maxPages; page++) {
          const separator = path.includes('?') ? '&' : '?'
          const result = await request<unknown>(`${path}${separator}per_page=${perPage}&page=${page}`)
          const payload = key && result.data && typeof result.data === 'object'
            ? (result.data as Record<string, unknown>)[key] : result.data
          if (!Array.isArray(payload)) throw new DashboardError('INVALID_RESPONSE', 'GitHub returned an unexpected response. Refresh to try again.')
          items.push(...payload as T[])
          if (!result.next) return { items, truncated: false }
        }
        return { items, truncated: true }
      }

      async function optional<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
        try { return await fn() } catch (error) {
          if (error instanceof DashboardError && error.fatal) throw error
          warn(`${label}: ${error instanceof DashboardError ? error.message : 'Data unavailable. Refresh to try again.'}`)
          return null
        }
      }

      try {
        const [viewer, repository] = await Promise.all([
          request<GithubUser>('/user'), request<GithubRepository>(root)
        ])
        if (!viewer.data.login || !repository.data.name || !repository.data.owner?.login) {
          throw new DashboardError('INVALID_RESPONSE', 'GitHub did not identify the account or repository. Reconnect GitHub and choose the team repository again.', true)
        }
        if (repository.data.name.toLowerCase() !== input.repo.toLowerCase() ||
            repository.data.owner.login.toLowerCase() !== input.owner.toLowerCase()) {
          throw new DashboardError('TARGET_CHANGED', 'The GitHub repository changed. Choose the team upload target again.', true)
        }
        const [pulls, issuePage, runPage] = await Promise.all([
          pages<GithubPullRequest>(`${root}/pulls?state=open&sort=updated&direction=desc`, 10, MAX_PRS / 10),
          optional('Assigned issues', () => pages<GithubIssue>(`${root}/issues?state=open&assignee=*&sort=updated&direction=desc`, 50, MAX_ISSUES / 50)),
          optional('Workflow runs', () => pages<GithubWorkflowRun>(`${root}/actions/runs`, MAX_RUNS, 1, 'workflow_runs'))
        ])
        if (pulls.truncated) warn(`Only the ${MAX_PRS} most recently updated open pull requests are shown. Open GitHub for the full list.`)
        if (issuePage?.truncated) warn(`Only the first ${MAX_ISSUES} assigned issue records are shown. Open GitHub for the full list.`)
        if (runPage?.truncated) warn(`Only the ${MAX_RUNS} most recent workflow runs are shown.`)
        if (pulls.items.length) warn('Review labels summarize submitted reviews; required approvals and merge eligibility must be checked on GitHub. Older-commit approvals are not counted.')

        const pullRequests = await mapBounded(pulls.items, 4, async (pull): Promise<DashboardPullRequest> => {
          checkAbort()
          const base: DashboardPullRequest = {
            number: pull.number, title: pull.title, url: `${web}/pull/${pull.number}`,
            author: pull.user?.login ?? '', branch: pull.head?.ref ?? '', baseBranch: pull.base?.ref ?? '',
            draft: Boolean(pull.draft), updatedAt: pull.updated_at,
            reviewDecision: 'unknown',
            reviewRequested: (pull.requested_reviewers ?? []).some((user) => user.login?.toLowerCase() === viewer.data.login!.toLowerCase()),
            checks: { state: 'unknown', total: 0, completed: 0 }, assignees: logins(pull.assignees)
          }
          if (pull.requested_teams?.length) warn(`PR #${pull.number} requests a team review (${pull.requested_teams.map((team) => team.slug ?? 'team').join(', ')}). Individual review counts do not include team membership.`)
          const sha = pull.head?.sha
          if (!sha || !/^[a-f\d]{40}$/i.test(sha) || !Number.isSafeInteger(pull.number) || pull.number <= 0) {
            warn(`PR #${pull.number}: current commit data unavailable. Review and CI status are unknown.`)
            return base
          }
          const reviews = await optional(`PR #${pull.number} reviews`, () => pages<GithubReview>(`${root}/pulls/${pull.number}/reviews`, 100, DETAIL_PAGES))
          if (reviews?.truncated) warn(`PR #${pull.number}: review history is incomplete; review status is unknown.`)
          if (reviews && !reviews.truncated) base.reviewDecision = summarizeDashboardReviews(reviews.items, sha)
          const checks = await optional(`PR #${pull.number} checks`, () => pages<GithubCheckRun>(`${root}/commits/${sha}/check-runs?filter=latest`, 100, DETAIL_PAGES, 'check_runs'))
          const statuses = await optional(`PR #${pull.number} commit statuses`, () => pages<GithubCommitStatus>(`${root}/commits/${sha}/status`, 100, DETAIL_PAGES, 'statuses'))
          if (checks?.truncated || statuses?.truncated) warn(`PR #${pull.number}: CI data is incomplete; a passing result cannot be confirmed.`)
          base.checks = summarizeDashboardChecks(checks?.items ?? [], statuses?.items ?? [],
            Boolean(checks && statuses && !checks.truncated && !statuses.truncated))
          return base
        })
        checkAbort()
        return {
          repository: { owner: repository.data.owner.login, name: repository.data.name, url: web, defaultBranch: repository.data.default_branch ?? '' },
          viewerLogin: viewer.data.login, fetchedAt: new Date().toISOString(), pullRequests,
          issues: (issuePage?.items ?? []).filter((issue) => !issue.pull_request && logins(issue.assignees).length > 0).map((issue) => ({
            number: issue.number, title: issue.title, url: `${web}/issues/${issue.number}`,
            assignees: logins(issue.assignees), labels: (issue.labels ?? []).flatMap((label) =>
              typeof label === 'string' ? [label] : label.name ? [label.name] : []), updatedAt: issue.updated_at
          })),
          recentRuns: (runPage?.items ?? []).map((run) => ({
            id: run.id, name: run.name ?? 'Workflow', status: run.status ?? 'unknown', conclusion: run.conclusion ?? null,
            url: `${web}/actions/runs/${run.id}`, branch: run.head_branch ?? '', updatedAt: run.updated_at
          })), warnings,
          coverage: {
            pullRequests: pulls.truncated ? 'partial' : 'complete',
            issues: !issuePage ? 'unavailable' : issuePage.truncated ? 'partial' : 'complete',
            workflows: !runPage ? 'unavailable' : runPage.truncated ? 'partial' : 'complete'
          }
        }
      } finally {
        controller.abort('finished')
        clearTimeout(totalTimeout)
        input.signal?.removeEventListener('abort', onAbort)
      }
    }
  }
}
