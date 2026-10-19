import { describe, expect, it } from 'vitest'
import { buildGithubRemoteUrl, buildPullRequestUrl, githubAuthArgs } from '../remoteUrls'

describe('git remote URL helpers', () => {
  it('builds authenticated push URLs and GitHub compare links', () => {
    expect(buildGithubRemoteUrl('tony', 'demo-backup')).toBe(
      'https://github.com/tony/demo-backup.git'
    )
    const auth = githubAuthArgs('https://github.com/tony/demo.git', 'github_pat_123')
    expect(auth).not.toContain('credential.helper=')
    expect(auth.at(-1)).toBe('http.https://github.com/.extraheader=AUTHORIZATION: basic ' +
      Buffer.from('oauth2:github_pat_123').toString('base64'))
    expect(auth.join(' ')).not.toContain('github_pat_123')
    expect(buildPullRequestUrl('https://github.com/tony/demo.git', 'gat/update-copy')).toBe(
      'https://github.com/tony/demo/compare/gat%2Fupdate-copy?expand=1'
    )
  })

  it('refuses to attach a GitHub token to another HTTPS host or embedded credentials', () => {
    expect(() => githubAuthArgs('https://example.com/tony/demo.git', 'test-token')).toThrow()
    expect(() => githubAuthArgs('https://github.com.evil.example/tony/demo.git', 'test-token')).toThrow()
    expect(() => githubAuthArgs('https://old-token@github.com/tony/demo.git', 'test-token')).toThrow()
    expect(githubAuthArgs('git@github.com:tony/demo.git', 'test-token')).toEqual([])
  })
})
