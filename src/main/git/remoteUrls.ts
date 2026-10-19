export function buildGithubRemoteUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`
}

export function parseGithubRepository(url: string): { owner: string; repo: string } | null {
  const trimmed = url.trim()
  const match = trimmed.match(
    /^(?:https:\/\/(?:[^@]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/i
  )

  if (!match) return null

  return {
    owner: match[1],
    repo: match[2]
  }
}

/** Scope the credential to GitHub for this one git invocation; never save it in a URL. */
export function githubAuthArgs(remoteUrl: string, token?: string): string[] {
  if (!token || !remoteUrl.startsWith('https://')) return []
  const url = new URL(remoteUrl)
  if (url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password) {
    throw new Error('A GitHub token can only be used with a GitHub HTTPS remote without embedded credentials.')
  }
  const credential = Buffer.from(`oauth2:${token}`).toString('base64')
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${credential}`]
}

export function buildPullRequestUrl(remoteUrl: string, branchName: string): string | null {
  const repository = parseGithubRepository(remoteUrl)
  if (!repository) return null

  return `https://github.com/${repository.owner}/${repository.repo}/compare/${encodeURIComponent(branchName)}?expand=1`
}
