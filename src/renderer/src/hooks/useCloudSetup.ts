import { useCallback, useEffect, useRef, useState } from 'react'
import { validateBranchName } from '../branchValidation'
import { AppTerms } from '../i18n/terms'
import { invokeDb } from '../ipc'
import { useTerms } from './useTerms'
import {
  CloudSetupIntent,
  CollaborationBranchMode,
  Project,
  ProjectCloudTarget,
  ProjectFolderInspection,
  ProjectRemote
} from '../types'

const emptyTarget: ProjectCloudTarget = {
  mode: 'none',
  backup: null,
  collaboration: null
}

interface UseCloudSetupOptions {
  onReadyToUpload?: (target: ProjectCloudTarget) => void | Promise<void>
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'project'
}

function getDefaultWorkBranch(project: Project | null): string {
  return `gat/${slugify(project?.friendly_name ?? 'update')}`
}

function getBackupRepoName(project: Project | null): string {
  return `${slugify(project?.friendly_name ?? 'project')}-backup`
}

type CloudStatusTerms = Pick<
  AppTerms,
  | 'privateBackupReadyLabel'
  | 'cloudBackupNotSetUpLabel'
  | 'teamUploadReadyLabel'
  | 'teamUploadReviewBranchStatus'
  | 'teamUploadExistingBranchStatus'
  | 'teamUploadDefaultBranchStatus'
>

export function getCloudStatusLabel(target: ProjectCloudTarget, terms: CloudStatusTerms): string {
  if (target.mode === 'backup') {
    return terms.privateBackupReadyLabel
  }

  if (target.mode !== 'collaboration' || !target.collaboration?.repoOwner || !target.collaboration.repoName) {
    return terms.cloudBackupNotSetUpLabel
  }

  const remoteName = target.collaboration.remoteName
  const branchName = target.collaboration.selectedBranch ?? 'main'

  if (target.collaboration.branchMode === 'new_branch') {
    return terms.teamUploadReviewBranchStatus(remoteName, branchName)
  }

  if (target.collaboration.branchMode === 'danger_default_branch') {
    return terms.teamUploadDefaultBranchStatus(remoteName, branchName)
  }

  return terms.teamUploadExistingBranchStatus(remoteName, branchName)
}

function parseGithubRemote(url: string): { owner: string; repo: string } | null {
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

export function useCloudSetup(
  project: Project | null,
  options: UseCloudSetupOptions = {}
) {
  const t = useTerms()
  const projectId = project?.project_id ?? null
  const activeProjectRef = useRef({ projectId })
  if (activeProjectRef.current.projectId !== projectId) {
    activeProjectRef.current = { projectId }
  }
  const projectScope = activeProjectRef.current
  const targetRequestRef = useRef(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownedTarget, setOwnedTarget] = useState<{
    projectId: string | null
    value: ProjectCloudTarget
  }>({ projectId: null, value: emptyTarget })
  // Do not expose the previous project's target while the next request loads.
  const target = ownedTarget.projectId === projectId ? ownedTarget.value : emptyTarget
  const [remotes, setRemotes] = useState<ProjectRemote[]>([])
  const [intent, setIntent] = useState<CloudSetupIntent | null>(null)
  const [branchMode, setBranchMode] = useState<CollaborationBranchMode>('new_branch')
  const [selectedRemoteName, setSelectedRemoteName] = useState('')
  const [selectedBranch, setSelectedBranch] = useState(getDefaultWorkBranch(project))
  const [pendingUpload, setPendingUpload] = useState(false)

  const refreshTarget = useCallback(async () => {
    if (activeProjectRef.current !== projectScope) return
    const requestId = ++targetRequestRef.current
    const isCurrentRequest = (): boolean =>
      activeProjectRef.current === projectScope && targetRequestRef.current === requestId

    if (!projectScope.projectId) {
      setOwnedTarget({ projectId: null, value: emptyTarget })
      return
    }

    try {
      const nextTarget = await invokeDb<ProjectCloudTarget>('cloud:target:get', projectScope.projectId)
      if (isCurrentRequest()) {
        setOwnedTarget({ projectId: projectScope.projectId, value: nextTarget })
      }
    } catch (caughtError) {
      if (isCurrentRequest()) {
        setOwnedTarget({ projectId: projectScope.projectId, value: emptyTarget })
      }
      throw caughtError
    }
  }, [projectScope])

  useEffect(() => {
    setIsOpen(false)
    setPendingUpload(false)
    setLoading(false)
    setError(null)
    refreshTarget().catch(() => undefined)
    return () => { targetRequestRef.current += 1 }
  }, [refreshTarget])

  const applyMutatedTarget = useCallback((nextTarget: ProjectCloudTarget): boolean => {
    if (activeProjectRef.current !== projectScope) return false
    // A read started before/during setup must not overwrite its saved result.
    targetRequestRef.current += 1
    setOwnedTarget({ projectId: projectScope.projectId, value: nextTarget })
    return true
  }, [projectScope])

  const resetWizardState = useCallback(() => {
    setError(null)
    setIntent(null)
    setRemotes([])
    setBranchMode('new_branch')
    setSelectedRemoteName('')
    setSelectedBranch(getDefaultWorkBranch(project))
  }, [project])

  const close = useCallback(() => {
    setIsOpen(false)
    setPendingUpload(false)
    resetWizardState()
  }, [resetWizardState])

  const open = useCallback(async (startUpload = false) => {
    if (!project || activeProjectRef.current !== projectScope) {
      return
    }

    setIsOpen(true)
    setPendingUpload(startUpload)
    resetWizardState()
    setLoading(true)

    try {
      const inspection = await invokeDb<ProjectFolderInspection>('project-setup:inspect', project.local_path)
      if (activeProjectRef.current !== projectScope) return
      setRemotes(inspection.remotes)
      setSelectedRemoteName(inspection.remotes[0]?.name ?? '')
    } catch (caughtError) {
      if (activeProjectRef.current === projectScope) {
        setError(getErrorMessage(caughtError, 'Could not inspect remotes for this project.'))
      }
    } finally {
      if (activeProjectRef.current === projectScope) setLoading(false)
    }
  }, [project, projectScope, resetWizardState])

  const chooseIntent = useCallback((nextIntent: CloudSetupIntent) => {
    setIntent(nextIntent)
  }, [])

  const selectRemote = useCallback((remoteName: string) => {
    setSelectedRemoteName(remoteName)
  }, [])

  const selectBranchMode = useCallback((nextBranchMode: CollaborationBranchMode) => {
    setBranchMode(nextBranchMode)
    if (nextBranchMode === 'new_branch') {
      setSelectedBranch(getDefaultWorkBranch(project))
      return
    }

    if (nextBranchMode === 'danger_default_branch') {
      setSelectedBranch('main')
      return
    }

    setSelectedBranch('')
  }, [project])

  const createBackup = useCallback(async () => {
    if (!project || activeProjectRef.current !== projectScope) return

    setLoading(true)
    setError(null)

    try {
      const nextTarget = await invokeDb<ProjectCloudTarget>(
        'cloud:backup:create',
        project.project_id,
        getBackupRepoName(project)
      )

      if (!applyMutatedTarget(nextTarget)) return
      close()

      if (pendingUpload) {
        Promise.resolve(options.onReadyToUpload?.(nextTarget)).catch(() => undefined)
      }
    } catch (caughtError) {
      if (activeProjectRef.current === projectScope) {
        setError(getErrorMessage(caughtError, 'Could not create the private backup repository.'))
      }
    } finally {
      if (activeProjectRef.current === projectScope) setLoading(false)
    }
  }, [applyMutatedTarget, close, options, pendingUpload, project, projectScope])

  const saveCollaborationTarget = useCallback(async () => {
    if (!project || activeProjectRef.current !== projectScope) return

    const selectedRemote = remotes.find((remote) => remote.name === selectedRemoteName)
    if (!selectedRemote) {
      setError('Choose which remote should receive team uploads.')
      return
    }

    const parsedRepository =
      parseGithubRemote(selectedRemote.push) ?? parseGithubRemote(selectedRemote.fetch)

    if (!parsedRepository) {
      setError('This collaboration remote is not a GitHub repository.')
      return
    }

    const branchValidation = validateBranchName(selectedBranch)
    if (!branchValidation.ok) {
      setError(branchValidation.message)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const nextTarget = await invokeDb<ProjectCloudTarget>('cloud:collaboration:set', project.project_id, {
        repoOwner: parsedRepository.owner,
        repoName: parsedRepository.repo,
        remoteName: selectedRemoteName,
        branchMode,
        selectedBranch: selectedBranch.trim()
      })

      if (!applyMutatedTarget(nextTarget)) return
      close()

      if (pendingUpload) {
        Promise.resolve(options.onReadyToUpload?.(nextTarget)).catch(() => undefined)
      }
    } catch (caughtError) {
      if (activeProjectRef.current === projectScope) {
        setError(getErrorMessage(caughtError, 'Could not save the team upload target.'))
      }
    } finally {
      if (activeProjectRef.current === projectScope) setLoading(false)
    }
  }, [
    applyMutatedTarget,
    branchMode,
    close,
    options,
    pendingUpload,
    project,
    projectScope,
    remotes,
    selectedBranch,
    selectedRemoteName
  ])

  // Older saved targets must be selected once again to verify their repository.
  // The next Upload click then opens setup instead of repeatedly failing in IPC.
  const cloudUploadReady = target.mode === 'backup'
    ? Boolean(target.backup)
    : target.mode === 'collaboration' && Boolean(
      target.collaboration?.repoOwner && target.collaboration.repoName && target.collaboration.selectedBranch
    )
  const cloudStatusLabel = getCloudStatusLabel(target, t)

  return {
    isOpen,
    loading,
    error,
    target,
    remotes,
    intent,
    branchMode,
    selectedRemoteName,
    selectedBranch,
    cloudUploadReady,
    cloudStatusLabel,
    open,
    close,
    chooseIntent,
    selectRemote,
    selectBranchMode,
    setSelectedBranch,
    createBackup,
    saveCollaborationTarget,
    refreshTarget
  }
}
