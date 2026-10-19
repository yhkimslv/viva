// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardSnapshot } from '../../../shared/dashboard'
import { githubLink, LeadDashboard } from '../components/LeadDashboard/LeadDashboard'

const { useLeadDashboard, refresh } = vi.hoisted(() => ({ useLeadDashboard: vi.fn(), refresh: vi.fn() }))
vi.mock('../hooks/useLeadDashboard', () => ({ useLeadDashboard }))

const snapshot: DashboardSnapshot = {
  repository: { owner: 'team', name: 'project', url: 'https://github.com/team/project', defaultBranch: 'main' },
  viewerLogin: 'lead', fetchedAt: '2026-10-19T20:00:00Z',
  pullRequests: [{
    number: 12, title: 'Add team onboarding', url: 'https://github.com/team/project/pull/12', author: 'alice',
    branch: 'feature/onboarding', baseBranch: 'main', draft: false, updatedAt: '2026-10-19T20:00:00Z',
    reviewDecision: 'review_required', reviewRequested: true, checks: { state: 'failing', total: 2, completed: 2 }, assignees: ['alice']
  }, {
    number: 13, title: 'Improve dashboard', url: 'https://github.com/team/project/pull/13', author: 'bob',
    branch: 'feature/dashboard', baseBranch: 'main', draft: false, updatedAt: '2026-10-19T20:00:00Z',
    reviewDecision: 'unknown', reviewRequested: false, checks: { state: 'unknown', total: 0, completed: 0 }, assignees: []
  }],
  issues: [{ number: 5, title: 'Ship the prototype', url: 'https://github.com/team/project/issues/5', assignees: ['alice', 'bob'], labels: ['milestone'], updatedAt: '2026-10-19T20:00:00Z' }],
  recentRuns: [{ id: 101, name: 'Build app', status: 'completed', conclusion: 'failure', url: 'https://github.com/team/project/actions/runs/101', branch: 'feature/onboarding', updatedAt: '2026-10-19T20:00:00Z' }],
  warnings: ['Only submitted review summaries are shown. Check merge rules on GitHub.']
}

function props() {
  return {
    projectId: 'project-1', language: 'en' as const, connected: true, repositoryReady: true,
    contextKey: 'repo', onConnect: vi.fn(), onSetup: vi.fn(), onClose: vi.fn()
  }
}

describe('LeadDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useLeadDashboard.mockReturnValue({ snapshot, loading: false, error: null, refresh })
  })
  afterEach(cleanup)

  it('shows PR review state, CI failures, ownership, and timestamps', () => {
    render(<LeadDashboard {...props()} />)

    expect(screen.getByRole('link', { name: 'Add team onboarding ↗' }).getAttribute('href')).toBe('https://github.com/team/project/pull/12')
    expect(screen.getByText('CI failing · 2/2')).toBeTruthy()
    expect(screen.getByText('alice, bob')).toBeTruthy()
    expect(screen.getByText('Build app ↗')).toBeTruthy()
    expect(screen.getByText(snapshot.warnings[0])).toBeTruthy()
    expect(screen.queryByText('CI passing')).toBeNull()
    expect(screen.getAllByText('Needs checking · 1')).toHaveLength(2)
  })

  it('filters PRs by review requests and failing CI', () => {
    render(<LeadDashboard {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'My review requests' }))

    expect(screen.getByText('Add team onboarding ↗')).toBeTruthy()
    expect(screen.queryByText('Improve dashboard ↗')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Improve dashboard ↗')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Failing CI' }))
    expect(screen.queryByText('Improve dashboard ↗')).toBeNull()
  })

  it('offers GitHub connection without showing old data while disconnected', () => {
    const options = { ...props(), connected: false }
    render(<LeadDashboard {...options} />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }))

    expect(options.onConnect).toHaveBeenCalledOnce()
    expect(screen.queryByText('Add team onboarding ↗')).toBeNull()
  })

  it('explains a failed refresh without hiding the previous successful snapshot', () => {
    useLeadDashboard.mockReturnValue({ snapshot, loading: false, error: 'Missing checks permission', refresh })
    render(<LeadDashboard {...props()} />)

    expect(screen.getByRole('alert').textContent).toContain('Showing the last successful result')
    expect(screen.getByText('Add team onboarding ↗')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('renders Korean labels and returns to the file view', () => {
    const options = props()
    render(<LeadDashboard {...options} language="ko" />)
    expect(screen.getByRole('heading', { name: '리드 대시보드' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '파일로 돌아가기' }))
    expect(options.onClose).toHaveBeenCalledOnce()
  })

  it('does not turn untrusted URL schemes into clickable links', () => {
    expect(githubLink('javascript:alert(1)')).toBeUndefined()
    expect(githubLink('https://github.com.example.com/team/project')).toBeUndefined()
    expect(githubLink('https://token@github.com/team/project')).toBeUndefined()
    expect(githubLink('https://github.com/team/project')).toBe('https://github.com/team/project')
  })

  it('distinguishes missing permissions from no assigned work', () => {
    useLeadDashboard.mockReturnValue({ snapshot: {
      ...snapshot, issues: [], recentRuns: [],
      coverage: { pullRequests: 'partial', issues: 'unavailable', workflows: 'unavailable' }
    }, loading: false, error: null, refresh })
    render(<LeadDashboard {...props()} />)

    expect(screen.getByText('Unavailable')).toBeTruthy()
    expect(screen.getByText('Assigned issues could not be loaded. Check access and coverage details below.')).toBeTruthy()
    expect(screen.getByText('Workflow runs could not be loaded. Check access details below.')).toBeTruthy()
    expect(screen.queryByText('No assigned issues were returned.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open PRs: ≥ 2' })).toBeTruthy()
  })
})
