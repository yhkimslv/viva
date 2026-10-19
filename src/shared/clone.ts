export type CloneErrorCode =
  | 'invalid-url' | 'invalid-name' | 'invalid-parent' | 'destination-exists'
  | 'destination-changed' | 'busy' | 'cancelled' | 'git-unavailable'
  | 'authentication' | 'network' | 'disk-space' | 'permission' | 'registration' | 'publication' | 'failed'

export type ClonePhase = 'preparing' | 'receiving' | 'resolving' | 'checkout' | 'publishing' | 'registering'

export interface CloneInput {
  jobId: string
  repositoryUrl: string
  parentPath: string
  directoryName: string
}

export interface CloneProgress {
  jobId: string
  phase: ClonePhase
  percent?: number
}

export interface ClonedProject {
  project_id: string
  local_path: string
  friendly_name: string
  last_accessed: number
}

export type CloneResult =
  | { ok: true; project: ClonedProject }
  | { ok: false; code: CloneErrorCode; localPath?: string }

// Limit cloning to a single known HTTPS host. Credentials, redirects, alternate
// transports, and URL rewrites must never expand the destination of a token.
export function normalizeCloneUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null
  const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})\/?$/i.exec(value.trim())
  if (!match || match[1].endsWith('-')) return null
  const repo = match[2].replace(/\.git$/i, '')
  if (!repo || repo === '.' || repo === '..' || repo.endsWith('.')) return null
  return `https://github.com/${match[1]}/${repo}.git`
}

export function isCloneDirectoryName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100 &&
    value === value.trim() && !/^[.]/.test(value) && !/[. ]$/.test(value) &&
    !/[<>:"/\\|?*\x00-\x1f]/.test(value) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)
}
