import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { simpleGit } from 'simple-git'
import { getGitService, removeGitService } from '../git'
import { addAiCommitSummary, AiCommitChangeKind } from '../db/aiSummaries'
import { getCachedStatus, setCachedStatus, invalidateCache } from '../db/statusCache'
import { getGithubToken } from '../db/credentials'
import { getProjectCloudTarget, setProjectCloudTarget } from '../db/projectCloudTargets'
import type { GitIdentityInput } from '../../shared/gitIdentity'
import {
  GitError,
  PullConfiguredTargetInput,
  PushConfiguredTargetInput,
  PushToCloudOptions
} from '../git/types'

interface CommitAiMetadata {
  message: string
  summary: string
  fingerprint: string
  model: string
  change_kind?: AiCommitChangeKind
  user_visible?: boolean
  areas?: string[]
  keywords?: string[]
}

const projectOperations = new Map<string, Promise<void>>()
const readOnlyChannels = new Set([
  'git:status', 'git:files:tracked', 'git:branches', 'git:branch:default',
  'git:conflict:versions', 'git:log', 'git:timeline', 'git:restore:preview', 'git:identity:get'
])

/** Keep each multi-command operation and its target metadata in one project transaction. */
function handleProject<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, projectId: string, ...args: Args) => Result | Promise<Result>
): void {
  ipcMain.handle(channel, (event, projectId: string, ...args: Args) => {
    const previous = projectOperations.get(projectId) ?? Promise.resolve()
    const changesStatus = !readOnlyChannels.has(channel)
    const operation = previous.then(async () => {
      if (changesStatus) invalidateCache(projectId)
      try {
        return await handler(event, projectId, ...args)
      } finally {
        if (changesStatus) invalidateCache(projectId)
      }
    })
    // A failed command must release the queue for recovery or the next status read.
    const settled = operation.then(() => undefined, () => undefined)
    projectOperations.set(projectId, settled)
    void settled.then(() => {
      if (projectOperations.get(projectId) === settled) projectOperations.delete(projectId)
    })
    return operation
  })
}

// Wrap a git call so IPC errors are serialisable plain objects (Errors don't
// survive the IPC boundary cleanly in Electron).
async function run<T>(fn: () => Promise<T>): Promise<{ data: T } | { error: GitError }> {
  try {
    const data = await fn()
    return { data }
  } catch (err) {
    return { error: err as GitError }
  }
}

function noRemoteError(message: string): GitError {
  return {
    code: 'NO_REMOTE',
    message
  }
}

function missingBranchError(message: string): GitError {
  return {
    code: 'BRANCH_NOT_FOUND',
    message
  }
}

function getPushTarget(project_id: string, token?: string, options?: PushToCloudOptions): PushConfiguredTargetInput {
  const target = getProjectCloudTarget(project_id)

  if (target.mode === 'backup' && target.backup) {
    return {
      mode: 'backup',
      remoteName: target.backup.remoteName,
      repoOwner: target.backup.repoOwner,
      repoName: target.backup.repoName,
      token
    }
  }

  if (target.mode === 'collaboration' && target.collaboration) {
    if (!target.collaboration.repoOwner || !target.collaboration.repoName) {
      throw noRemoteError('Choose the team upload target again so VIVA can verify the repository.')
    }
    if (!target.collaboration.selectedBranch) {
      throw missingBranchError('Choose a work branch before uploading to the team repository.')
    }

    return {
      mode: 'collaboration',
      remoteName: target.collaboration.remoteName,
      branchMode: target.collaboration.branchMode,
      branchName: target.collaboration.selectedBranch,
      repoOwner: target.collaboration.repoOwner,
      repoName: target.collaboration.repoName,
      dangerConfirmed: options?.dangerConfirmed,
      token
    }
  }

  throw noRemoteError('Set up Upload to Cloud before uploading this project.')
}

function getPullTarget(project_id: string, token?: string): PullConfiguredTargetInput {
  const target = getProjectCloudTarget(project_id)

  if (target.mode === 'collaboration' && target.collaboration?.selectedBranch) {
    if (!target.collaboration.repoOwner || !target.collaboration.repoName) {
      throw noRemoteError('Choose the team upload target again so VIVA can verify the repository.')
    }
    return {
      remoteName: target.collaboration.remoteName,
      branchName: target.collaboration.selectedBranch,
      repoOwner: target.collaboration.repoOwner,
      repoName: target.collaboration.repoName,
      token
    }
  }

  throw noRemoteError('Set up a team upload target before getting updates.')
}

export function registerGitHandlers(): void {
  handleProject('git:identity:get', (_event, projectId: string) => run(() => getGitService(projectId).getIdentity()))
  handleProject('git:identity:set', (_event, projectId: string, input: GitIdentityInput) => run(() => getGitService(projectId).setIdentity(input)))

  // Check whether git is installed and reachable on PATH
  ipcMain.handle('git:install:check', async () => {
    try {
      const vr = await simpleGit().version()
      if (!vr.installed) return { installed: false }
      return { installed: true, version: `${vr.major}.${vr.minor}.${vr.patch}` }
    } catch {
      return { installed: false }
    }
  })

  // Initialize a git repo in the project's folder
  handleProject('git:init', async (_event, project_id: string) => {
    const result = await run(() => getGitService(project_id).init())
    // Recreate the service so subsequent calls see the new repo
    removeGitService(project_id)
    return result
  })

  // Validate a folder path is an existing git repo (pre-flight before adding)
  ipcMain.handle('git:check-repo', async (_event, local_path: string) => {
    try {
      await simpleGit(local_path).status()
      return { isRepo: true }
    } catch {
      return { isRepo: false }
    }
  })

  // Status — cache-first; populates statusCache on miss
  handleProject('git:status', async (_event, project_id: string) => {
    const cached = getCachedStatus(project_id)
    if (cached) return { data: cached }

    return run(async () => {
      const status = await getGitService(project_id).getStatus()
      setCachedStatus(project_id, status)
      return status
    })
  })

  handleProject('git:stage', async (_event, project_id: string, paths: string[]) => {
    const result = await run(() => getGitService(project_id).stage(paths))
    invalidateCache(project_id)
    return result
  })

  handleProject('git:unstage', async (_event, project_id: string, paths: string[]) => {
    const result = await run(() => getGitService(project_id).unstage(paths))
    invalidateCache(project_id)
    return result
  })

  handleProject(
    'git:commit',
    async (_event, project_id: string, message: string, aiMetadata?: CommitAiMetadata) => {
      const result = await run(async () => {
        const commitHash = await getGitService(project_id).commitAndGetHash(message)
        if (aiMetadata?.summary) {
          addAiCommitSummary({
            project_id,
            commit_hash: commitHash,
            message: aiMetadata.message,
            summary: aiMetadata.summary,
            created_at: Date.now(),
            model: aiMetadata.model,
            fingerprint: aiMetadata.fingerprint,
            change_kind: aiMetadata.change_kind,
            user_visible: aiMetadata.user_visible,
            areas: aiMetadata.areas,
            keywords: aiMetadata.keywords
          })
        }
        return commitHash
      })
      invalidateCache(project_id)
      return result
    }
  )

  handleProject('git:push', async (_event, project_id: string, options?: PushToCloudOptions) => {
    const token = getGithubToken() ?? undefined
    const result = await run(async () => {
      const uploaded = await getGitService(project_id).pushConfiguredTarget(getPushTarget(project_id, token, options))
      const target = getProjectCloudTarget(project_id)
      if (target.mode === 'collaboration' && target.collaboration?.selectedBranch === uploaded.branchName &&
        target.collaboration.branchMode === 'new_branch') {
        setProjectCloudTarget(project_id, {
          ...target,
          collaboration: { ...target.collaboration, branchMode: 'existing_branch' }
        })
      }
      return uploaded
    })
    invalidateCache(project_id)
    return result
  })

  handleProject('git:pull', async (_event, project_id: string) => {
    const token = getGithubToken() ?? undefined
    const result = await run(() =>
      getGitService(project_id).pullConfiguredTarget(getPullTarget(project_id, token))
    )
    invalidateCache(project_id)
    return result
  })

  handleProject('git:pull:preview', async (_event, project_id: string, limit?: number) => {
    const token = getGithubToken() ?? undefined
    const result = await run(() =>
      getGitService(project_id).previewPullUpdates(getPullTarget(project_id, token), limit)
    )
    invalidateCache(project_id)
    return result
  })

  handleProject('git:files:tracked', (_event, project_id: string) =>
    run(() => getGitService(project_id).listTrackedFiles())
  )

  handleProject('git:branches', (_event, project_id: string) =>
    run(() => getGitService(project_id).getBranches())
  )

  handleProject('git:branch:default', (_event, project_id: string, remoteName?: string) =>
    run(() => getGitService(project_id).getDefaultBranch(remoteName ?? 'origin', getGithubToken() ?? undefined))
  )

  handleProject('git:branch:create', (_event, project_id: string, name: string) =>
    (async () => {
      const token = getGithubToken() ?? undefined
      const target = getProjectCloudTarget(project_id)
      const remoteName =
        target.mode === 'collaboration' && target.collaboration?.remoteName
          ? target.collaboration.remoteName
          : 'origin'

      const result = await run(() =>
        getGitService(project_id).createBranch(name, {
          remoteName,
          token,
          publishRemote: target.mode === 'collaboration' && Boolean(target.collaboration?.repoOwner && target.collaboration.repoName),
          repoOwner: target.collaboration?.repoOwner,
          repoName: target.collaboration?.repoName
        })
      )

      if ('data' in result && target.mode === 'collaboration' && target.collaboration) {
        setProjectCloudTarget(project_id, {
          ...target,
          collaboration: {
            ...target.collaboration,
            selectedBranch: name,
            branchMode: 'existing_branch'
          }
        })
      }

      invalidateCache(project_id)
      return result
    })()
  )

  handleProject('git:branch:switch', (_event, project_id: string, name: string) =>
    (async () => {
      const target = getProjectCloudTarget(project_id)
      const result = await run(() => getGitService(project_id).switchBranch(name))

      if ('data' in result && target.mode === 'collaboration' && target.collaboration) {
        const defaultBranch = await getGitService(project_id).getDefaultBranch(
          target.collaboration.remoteName, getGithubToken() ?? undefined
        )
        setProjectCloudTarget(project_id, {
          ...target,
          collaboration: {
            ...target.collaboration,
            selectedBranch: name,
            branchMode: name === defaultBranch || (!defaultBranch && ['main', 'master'].includes(name))
              ? 'danger_default_branch' : 'existing_branch'
          }
        })
      }

      invalidateCache(project_id)
      return result
    })()
  )

  handleProject('git:branch:merge', async (_event, project_id: string, name: string) => {
    const result = await run(() => getGitService(project_id).mergeBranch(name))
    invalidateCache(project_id)
    return result
  })

  handleProject('git:branch:delete', (_event, project_id: string, name: string) =>
    (async () => {
      const token = getGithubToken() ?? undefined
      const target = getProjectCloudTarget(project_id)
      const remoteName =
        target.mode === 'collaboration' && target.collaboration?.remoteName
          ? target.collaboration.remoteName
          : 'origin'

      const result = await run(() =>
        getGitService(project_id).deleteBranch(name, {
          remoteName,
          token,
          deleteRemote: target.mode === 'collaboration' && Boolean(target.collaboration?.repoOwner && target.collaboration.repoName),
          repoOwner: target.collaboration?.repoOwner,
          repoName: target.collaboration?.repoName
        })
      )

      if (
        'data' in result &&
        target.mode === 'collaboration' &&
        target.collaboration &&
        target.collaboration.selectedBranch === name
      ) {
        setProjectCloudTarget(project_id, {
          ...target,
          collaboration: {
            ...target.collaboration,
            selectedBranch: result.data.current_branch
          }
        })
      }

      invalidateCache(project_id)
      return result
    })()
  )

  handleProject('git:untracked:delete', async (_event, project_id: string, paths: string[]) => {
    const result = await run(() => getGitService(project_id).deleteUntracked(paths))
    invalidateCache(project_id)
    return result
  })

  handleProject('git:revert', (_event, project_id: string, path: string) =>
    run(() => getGitService(project_id).revertFile(path))
  )

  handleProject('git:conflict:versions', (_event, project_id: string, filePath: string) =>
    run(() => getGitService(project_id).getConflictVersions(filePath))
  )

  handleProject(
    'git:conflict:resolve',
    (_event, project_id: string, filePath: string, strategy: 'ours' | 'theirs') => {
      return run(async () => {
        await getGitService(project_id).resolveConflict(filePath, strategy)
        invalidateCache(project_id)
      })
    }
  )

  handleProject('git:conflict:abort', async (_event, project_id: string) => {
    const result = await run(() => getGitService(project_id).abortMerge())
    invalidateCache(project_id)
    return result
  })

  handleProject(
    'git:log',
    (_event, project_id: string, limit?: number) =>
      run(() => getGitService(project_id).getLog(limit))
  )

  handleProject(
    'git:timeline',
    (_event, project_id: string, limit?: number) =>
      run(() => getGitService(project_id).getTimeline(limit))
  )

  handleProject(
    'git:restore:preview',
    (_event, project_id: string, commitHash: string) =>
      run(() => getGitService(project_id).getRestorePreview(commitHash))
  )

  handleProject(
    'git:restore:apply',
    async (_event, project_id: string, commitHash: string) => {
      const result = await run(() => getGitService(project_id).restoreToCommit(commitHash))
      invalidateCache(project_id)
      return result
    }
  )

  // Clean up service instance when a project is removed
  handleProject('git:service:remove', (_event, project_id: string) => {
    removeGitService(project_id)
  })
}
