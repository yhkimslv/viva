import { ipcMain } from 'electron'
import { getGithubToken } from '../db/credentials'
import { getProjectCloudTarget } from '../db/projectCloudTargets'
import { getGitService } from '../git'
import { parseGithubRepository } from '../git/remoteUrls'
import { createDashboardService, DashboardError, validateDashboardRepository } from '../github/dashboardService'

const service = createDashboardService()

export function registerDashboardHandlers(): void {
  ipcMain.handle('dashboard:get', async (_event, projectId: string, refresh?: boolean) => {
    if (typeof projectId !== 'string' || !projectId || (refresh !== undefined && typeof refresh !== 'boolean')) {
      throw new Error('[SETUP_REQUIRED] Choose a project before opening the lead dashboard.')
    }
    const target = getProjectCloudTarget(projectId)
    let repository: { remoteName: string; repoOwner?: string; repoName?: string } | null = target.mode === 'collaboration' ? target.collaboration
      : target.mode === 'backup' ? target.backup : null
    const inferredOrigin = target.mode === 'none'
    if (inferredOrigin) {
      try {
        const origins = (await getGitService(projectId).getRemotes()).filter((remote) => remote.name === 'origin')
        const origin = origins.length === 1 ? origins[0] : null
        const fetchRepo = origin ? parseGithubRepository(origin.fetch) : null
        const pushRepo = origin ? parseGithubRepository(origin.push) : null
        if (fetchRepo && pushRepo && fetchRepo.owner.toLowerCase() === pushRepo.owner.toLowerCase() &&
            fetchRepo.repo.toLowerCase() === pushRepo.repo.toLowerCase()) {
          repository = { remoteName: 'origin', repoOwner: fetchRepo.owner, repoName: fetchRepo.repo }
        }
      } catch {
        // A missing local repository is also a setup problem, never an excuse to
        // query a URL supplied by the renderer or to enable uploads implicitly.
      }
    }
    if (!repository?.repoOwner || !repository.repoName || !repository.remoteName) {
      throw new Error('[SETUP_REQUIRED] Connect a project with a single GitHub origin, or choose a repository in Upload to Cloud to open the lead dashboard.')
    }
    try {
      validateDashboardRepository(repository.repoOwner, repository.repoName)
    } catch {
      throw new Error('[SETUP_REQUIRED] Choose a valid GitHub repository before opening the lead dashboard.')
    }
    const token = getGithubToken()
    if (!token) throw new Error('[NOT_CONNECTED] Connect GitHub in Settings before opening the lead dashboard.')
    try {
      await getGitService(projectId).validateCollaborationRemote(repository.remoteName, repository.repoOwner, repository.repoName)
    } catch {
      throw new Error('[SETUP_REQUIRED] The repository remote changed or is unavailable. Choose a single GitHub repository before opening the lead dashboard.')
    }
    try {
      const snapshot = await service.getSnapshot({ token, owner: repository.repoOwner, repo: repository.repoName })
      // Never deliver an old account or target's data after sign-out or a settings switch.
      const assertCurrentSession = (): void => {
        const current = getProjectCloudTarget(projectId)
        if (getGithubToken() !== token || JSON.stringify(current) !== JSON.stringify(target)) {
          throw new DashboardError('TARGET_CHANGED', 'GitHub account or upload target changed. Refresh the lead dashboard.', true)
        }
      }
      assertCurrentSession()
      if (inferredOrigin) {
        try {
          await getGitService(projectId).validateCollaborationRemote(repository.remoteName, repository.repoOwner, repository.repoName)
        } catch {
          throw new DashboardError('SETUP_REQUIRED', 'The GitHub origin changed while loading. Choose a single repository and refresh the lead dashboard.', true)
        }
        assertCurrentSession()
      }
      return snapshot
    } catch (error) {
      // Upstream response text and credentials are deliberately excluded from IPC errors.
      if (error instanceof DashboardError) throw new Error(`[${error.code}] ${error.message}`)
      throw new Error('[NETWORK] Could not load the GitHub dashboard. Check your connection and refresh.')
    }
  })
}
