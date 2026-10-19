import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDashboardService, summarizeDashboardChecks, summarizeDashboardReviews,
  type GithubReview
} from '../dashboardService'

const sha = 'a'.repeat(40)
const input = { token: 'secret-token', owner: 'team', repo: 'project' }
const pull = {
  number: 12, title: 'Team work', user: { login: 'author' }, updated_at: '2026-10-19T10:00:00Z',
  head: { sha, ref: 'feature' }, base: { ref: 'main' }, requested_reviewers: [{ login: 'lead' }],
  assignees: [{ login: 'developer' }]
}

function json(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), { status, headers })
}

function api(overrides: (url: URL, init?: RequestInit) => Response | Promise<Response | undefined> | undefined = () => undefined) {
  return vi.fn(async (urlInput: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof urlInput === 'string' ? urlInput : urlInput instanceof URL ? urlInput.href : urlInput.url)
    const custom = await overrides(url, init)
    if (custom) return custom
    if (url.pathname === '/user') return json({ login: 'lead' })
    if (url.pathname === '/repos/team/project') return json({ owner: { login: 'team' }, name: 'project', default_branch: 'main' })
    if (url.pathname.endsWith('/pulls')) return json([pull])
    if (url.pathname.endsWith('/issues')) return json([
      { number: 4, title: 'Assigned to another teammate', assignees: [{ login: 'developer' }], labels: [{ name: 'bug' }], updated_at: 'today' },
      { number: 12, title: 'PR from issue API', assignees: [{ login: 'lead' }], pull_request: {}, updated_at: 'today' },
      { number: 5, title: 'Unassigned', assignees: [], updated_at: 'today' }
    ])
    if (url.pathname.endsWith('/actions/runs')) return json({ workflow_runs: [
      { id: 99, name: 'CI', status: 'completed', conclusion: 'success', head_branch: 'feature', updated_at: 'today' }
    ] })
    if (url.pathname.endsWith('/reviews')) return json([
      { id: 1, user: { login: 'reviewer' }, state: 'APPROVED', commit_id: sha }
    ])
    if (url.pathname.endsWith('/check-runs')) return json({ check_runs: [
      { id: 1, name: 'Tests', status: 'completed', conclusion: 'success' }
    ] })
    if (url.pathname.endsWith('/status')) return json({ statuses: [] })
    throw new Error(`Unexpected test path ${url.pathname}`)
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch
}

afterEach(() => { vi.useRealTimers() })

describe('GitHub lead dashboard reads', () => {
  it('reads real API shapes, team ownership and direct viewer requests with safe GitHub links', async () => {
    const fetch = api()
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(snapshot.repository).toEqual({ owner: 'team', name: 'project', defaultBranch: 'main', url: 'https://github.com/team/project' })
    expect(snapshot.viewerLogin).toBe('lead')
    expect(snapshot.pullRequests[0]).toMatchObject({
      number: 12, reviewRequested: true, reviewDecision: 'approved', checks: { state: 'passing', total: 1, completed: 1 }
    })
    expect(snapshot.issues).toHaveLength(1)
    expect(snapshot.issues[0].assignees).toEqual(['developer'])
    expect(snapshot.recentRuns[0].url).toBe('https://github.com/team/project/actions/runs/99')
    expect(snapshot.coverage).toEqual({ pullRequests: 'complete', issues: 'complete', workflows: 'complete' })
    expect(Number.isNaN(Date.parse(snapshot.fetchedAt))).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain(input.token)
    expect(snapshot.warnings.some((warning) => warning.includes('merge eligibility'))).toBe(true)
    expect(fetch.mock.calls.every(([url, init]) => String(url).startsWith('https://api.github.com/') && init.method === 'GET' && init.redirect === 'error')).toBe(true)
    expect(fetch.mock.calls.find(([url]) => String(url).includes('/issues?'))?.[0]).toContain('assignee=*')
  })

  it('follows pagination using the fixed endpoint rather than trusting link destinations', async () => {
    const fetch = api((url) => {
      if (!url.pathname.endsWith('/pulls')) return
      const page = Number(url.searchParams.get('page'))
      return json(page === 1 ? [pull] : [{ ...pull, number: 13 }], 200,
        page === 1 ? { link: '<https://evil.example/steal>; rel="next"' } : undefined)
    })
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(snapshot.pullRequests.map((item) => item.number)).toEqual([12, 13])
    expect(fetch.mock.calls.every(([url]) => new URL(String(url)).host === 'api.github.com')).toBe(true)
  })

  it('bounds lists and reports truncation instead of implying complete data', async () => {
    const fetch = api((url) => url.pathname.endsWith('/pulls')
      ? json([ { ...pull, number: Number(url.searchParams.get('page')) } ], 200, { link: '<ignored>; rel="next"' }) : undefined)
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith('/pulls'))).toHaveLength(3)
    expect(snapshot.warnings.some((warning) => warning.includes('30 most recently'))).toBe(true)
    expect(snapshot.coverage?.pullRequests).toBe('partial')
  })

  it('limits per-PR request concurrency to four', async () => {
    let active = 0
    let maximum = 0
    const fetch = api(async (url) => {
      if (url.pathname.endsWith('/pulls')) return json(Array.from({ length: 12 }, (_, index) => ({ ...pull, number: index + 1 })))
      if (!url.pathname.endsWith('/reviews')) return
      maximum = Math.max(maximum, ++active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active--
      return json([])
    })

    await createDashboardService({ fetch }).getSnapshot(input)
    expect(maximum).toBe(4)
  })

  it('preserves usable data while missing workflow read permission is explicit', async () => {
    const fetch = api((url) => url.pathname.endsWith('/actions/runs') ? json({ message: 'secret-token' }, 403) : undefined)
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(snapshot.pullRequests).toHaveLength(1)
    expect(snapshot.recentRuns).toEqual([])
    expect(snapshot.coverage?.workflows).toBe('unavailable')
    expect(snapshot.warnings.some((warning) => warning.includes('Workflow runs:') && warning.includes('read permissions'))).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain(input.token)
  })

  it('distinguishes unavailable assigned work from a confirmed empty issue list', async () => {
    const fetch = api((url) => url.pathname.endsWith('/issues') ? json({}, 403) : undefined)
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(snapshot.issues).toEqual([])
    expect(snapshot.coverage).toEqual({ pullRequests: 'complete', issues: 'unavailable', workflows: 'complete' })
    expect(snapshot.warnings.some((warning) => warning.includes('Assigned issues:') && warning.includes('read permissions'))).toBe(true)
  })

  it('never reports passing when either check API is unavailable', async () => {
    const fetch = api((url) => url.pathname.endsWith('/status') ? json({}, 404) : undefined)
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(snapshot.pullRequests[0].checks).toMatchObject({ state: 'unknown', total: 1, completed: 1 })
    expect(snapshot.warnings.some((warning) => warning.includes('commit statuses'))).toBe(true)
  })

  it('does not decide reviews using only the first part of a paginated review history', async () => {
    const fetch = api((url) => url.pathname.endsWith('/reviews')
      ? json([{ id: 1, user: { login: 'reviewer' }, state: 'APPROVED', commit_id: sha }], 200, { link: '<ignored>; rel="next"' }) : undefined)
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(snapshot.pullRequests[0].reviewDecision).toBe('unknown')
    expect(snapshot.warnings.some((warning) => warning.includes('review history is incomplete'))).toBe(true)
    expect(fetch.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith('/reviews'))).toHaveLength(2)
  })

  it('discloses requested team reviews without inventing membership', async () => {
    const fetch = api((url) => url.pathname.endsWith('/pulls') ? json([
      { ...pull, requested_reviewers: [], requested_teams: [{ slug: 'frontend' }] }
    ]) : undefined)
    const snapshot = await createDashboardService({ fetch }).getSnapshot(input)

    expect(snapshot.pullRequests[0].reviewRequested).toBe(false)
    expect(snapshot.warnings.some((warning) => warning.includes('frontend') && warning.includes('team membership'))).toBe(true)
  })

  it('fails loudly when the essential PR list is inaccessible', async () => {
    const fetch = api((url) => url.pathname.endsWith('/pulls') ? json({}, 403) : undefined)
    await expect(createDashboardService({ fetch }).getSnapshot(input)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
  })

  it.each([
    [401, {}, 'NOT_CONNECTED'],
    [403, { 'x-ratelimit-remaining': '0' }, 'RATE_LIMITED'],
    [429, {}, 'RATE_LIMITED'],
    [403, { 'retry-after': '60' }, 'RATE_LIMITED']
  ])('stops on HTTP %s auth or rate errors', async (status, headers, code) => {
    const fetch = api((url) => url.pathname === '/user' ? json({}, status as number, headers as Record<string, string>) : undefined)
    await expect(createDashboardService({ fetch }).getSnapshot(input)).rejects.toMatchObject({ code })
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/pulls?'))).toHaveLength(0)
  })

  it('rejects redirected repository identities', async () => {
    const fetch = api((url) => url.pathname === '/repos/team/project'
      ? json({ owner: { login: 'other' }, name: 'project' }) : undefined)
    await expect(createDashboardService({ fetch }).getSnapshot(input)).rejects.toMatchObject({ code: 'TARGET_CHANGED' })
  })

  it('stops secondary rate limits even without a Retry-After header', async () => {
    const fetch = api((url) => url.pathname.endsWith('/reviews')
      ? json({ message: 'You have exceeded a secondary rate limit.' }, 403) : undefined)
    await expect(createDashboardService({ fetch }).getSnapshot(input)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/check-runs'))).toHaveLength(0)
  })

  it.each([
    { owner: '../evil', repo: 'project' }, { owner: 'team', repo: 'project?token=bad' },
    { owner: 'https://evil.example', repo: 'project' }, { owner: 'team', repo: '..' }
  ])('rejects malformed repository identities before sending credentials', async (target) => {
    const fetch = api()
    await expect(createDashboardService({ fetch }).getSnapshot({ ...input, ...target })).rejects.toMatchObject({ code: 'INVALID_TARGET' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sanitizes network errors containing credentials', async () => {
    const fetch = api(() => { throw new Error(`Failed with ${input.token}`) })
    await expect(createDashboardService({ fetch }).getSnapshot(input)).rejects.toMatchObject({ code: 'NETWORK', message: 'Could not reach GitHub. Check your connection and refresh.' })
  })

  it('honors cancellation before starting and aborts an in-flight request', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = api()
    await expect(createDashboardService({ fetch }).getSnapshot({ ...input, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fetch).not.toHaveBeenCalled()

    const active = new AbortController()
    const waiting = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })) as unknown as typeof fetch
    const result = createDashboardService({ fetch: waiting }).getSnapshot({ ...input, signal: active.signal })
    active.abort()
    await expect(result).rejects.toMatchObject({ code: 'CANCELLED' })
  })

  it('times out hung GitHub reads and clears timers', async () => {
    vi.useFakeTimers()
    const waiting = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })) as unknown as typeof fetch
    const result = createDashboardService({ fetch: waiting, requestTimeoutMs: 100, totalTimeoutMs: 200 }).getSnapshot(input)
    const rejected = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' })
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('review summaries', () => {
  const review = (id: number, state: string, commit = sha): GithubReview => ({ id, state, commit_id: commit, user: { login: 'Reviewer' } })

  it('uses the latest decisive review from each reviewer, ignoring later comments', () => {
    expect(summarizeDashboardReviews([review(3, 'COMMENTED'), review(1, 'CHANGES_REQUESTED'), review(2, 'APPROVED')], sha)).toBe('approved')
    expect(summarizeDashboardReviews([review(2, 'CHANGES_REQUESTED'), review(1, 'APPROVED')], sha)).toBe('changes_requested')
  })
  it('does not count dismissed or stale-commit approvals', () => {
    expect(summarizeDashboardReviews([review(1, 'APPROVED'), review(2, 'DISMISSED')], sha)).toBe('review_required')
    expect(summarizeDashboardReviews([review(1, 'APPROVED', 'b'.repeat(40))], sha)).toBe('review_required')
  })
  it('keeps changes requested by another reviewer even when one has approved', () => {
    expect(summarizeDashboardReviews([review(1, 'APPROVED'), { ...review(2, 'CHANGES_REQUESTED'), user: { login: 'second' } }], sha)).toBe('changes_requested')
  })
})

describe('CI summaries', () => {
  it('counts success, skipped and neutral completed checks as passing', () => {
    expect(summarizeDashboardChecks(['success', 'skipped', 'neutral'].map((conclusion, id) => ({ id, status: 'completed', conclusion })), [])).toEqual({ state: 'passing', total: 3, completed: 3 })
  })
  it('takes only the latest commit status for each context', () => {
    expect(summarizeDashboardChecks([], [{ id: 1, context: 'CI', state: 'failure' }, { id: 2, context: 'CI', state: 'success' }])).toEqual({ state: 'passing', total: 1, completed: 1 })
  })
  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])('does not treat %s as passing', (conclusion) => {
    expect(summarizeDashboardChecks([{ id: 1, status: 'completed', conclusion }], []).state).toBe('failing')
  })
  it('distinguishes no CI from pending and unknown data', () => {
    expect(summarizeDashboardChecks([], []).state).toBe('none')
    expect(summarizeDashboardChecks([], [], false).state).toBe('unknown')
    expect(summarizeDashboardChecks([{ id: 1, status: 'in_progress', conclusion: null }], []).state).toBe('pending')
    expect(summarizeDashboardChecks([{ id: 1, status: 'completed', conclusion: null }], []).state).toBe('unknown')
    expect(summarizeDashboardChecks([], [{ id: 1, context: 'CI', state: 'error' }]).state).toBe('failing')
  })
})
