import { GitService } from '../git/service'
import type { ProjectFolderInspection } from './types'

/** Reads local Git configuration only; safe to refresh alongside project status. */
export async function inspectRepositoryConnection(
  localPath: string
): Promise<Pick<ProjectFolderInspection, 'isGitRepo' | 'remotes'>> {
  const gitService = new GitService(localPath)
  const isGitRepo = await gitService.isRepository()

  return {
    isGitRepo,
    remotes: isGitRepo ? await gitService.getRemotes() : []
  }
}
