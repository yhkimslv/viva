/** Read-only GitHub data. Credentials never cross the main-process boundary. */
export interface DashboardSnapshot {
  repository: { owner: string; name: string; url: string; defaultBranch: string }
  viewerLogin: string
  fetchedAt: string
  pullRequests: DashboardPullRequest[]
  issues: DashboardIssue[]
  recentRuns: DashboardWorkflowRun[]
  warnings: string[]
  /** Absent only in older snapshots; production always reports collection coverage. */
  coverage?: {
    pullRequests: 'complete' | 'partial'
    issues: 'complete' | 'partial' | 'unavailable'
    workflows: 'complete' | 'partial' | 'unavailable'
  }
}

export interface DashboardPullRequest {
  number: number
  title: string
  url: string
  author: string
  branch: string
  baseBranch: string
  draft: boolean
  updatedAt: string
  /** Summary of submitted reviews, never a claim that branch rules allow merging. */
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | 'unknown'
  /** An individual request for the signed-in viewer; team requests are reported separately. */
  reviewRequested: boolean
  checks: { state: 'passing' | 'failing' | 'pending' | 'none' | 'unknown'; total: number; completed: number }
  assignees: string[]
}

export interface DashboardIssue {
  number: number
  title: string
  url: string
  assignees: string[]
  labels: string[]
  updatedAt: string
}

export interface DashboardWorkflowRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  url: string
  branch: string
  updatedAt: string
}
