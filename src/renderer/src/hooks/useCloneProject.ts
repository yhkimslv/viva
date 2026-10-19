import { useCallback, useEffect, useRef, useState } from 'react'
import { CloneErrorCode, CloneProgress, CloneResult, isCloneDirectoryName, normalizeCloneUrl } from '../../../shared/clone'
import { useAppContext } from '../context/AppContext'
import { invokeDb } from '../ipc'
import { getCloneTerms } from '../i18n/clone'
import { Project } from '../types'

export function useCloneProject(options: { onCloned?: (project: Project) => void } = {}) {
  const { state, dispatch } = useAppContext()
  const language = state.preferences.language ?? 'en'
  const [isOpen, setIsOpen] = useState(false)
  const [repositoryUrl, updateRepositoryUrl] = useState('')
  const [directoryName, setDirectoryName] = useState('')
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [errorCode, setErrorCode] = useState<CloneErrorCode | null>(null)
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null)
  const jobRef = useRef<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.electron.ipcRenderer.on('project-setup:clone-progress', (_event, next: CloneProgress) => {
      if (next?.jobId === jobRef.current) setProgress(next)
    })
    return () => {
      mounted.current = false
      if (typeof unsubscribe === 'function') unsubscribe()
      else window.electron.ipcRenderer.removeAllListeners('project-setup:clone-progress')
      if (jobRef.current) void invokeDb('project-setup:clone-cancel', jobRef.current).catch(() => {})
    }
  }, [])

  const open = useCallback(() => {
    if (jobRef.current) return
    updateRepositoryUrl('')
    setDirectoryName('')
    setParentPath(null)
    setErrorCode(null)
    setRecoveryPath(null)
    setProgress(null)
    setCancelling(false)
    setIsOpen(true)
  }, [])
  const close = useCallback(() => {
    if (!jobRef.current) setIsOpen(false)
  }, [])
  const setRepositoryUrl = useCallback((value: string) => {
    updateRepositoryUrl(value)
    const normalized = normalizeCloneUrl(value)
    if (normalized) setDirectoryName((current) => current || normalized.split('/').pop()!.replace(/\.git$/, ''))
  }, [])
  const chooseParent = useCallback(async () => {
    try {
      const path = await invokeDb<string | null>('dialog:openFolder')
      if (path) setParentPath(path)
    } catch { setErrorCode('invalid-parent') }
  }, [])
  const cancel = useCallback(async () => {
    const jobId = jobRef.current
    if (!jobId) { setIsOpen(false); return }
    setCancelling(true)
    try { await invokeDb('project-setup:clone-cancel', jobId) }
    catch { setCancelling(false); setErrorCode('failed') }
  }, [])

  const submit = useCallback(async () => {
    if (jobRef.current) return
    if (!normalizeCloneUrl(repositoryUrl)) { setErrorCode('invalid-url'); return }
    if (!isCloneDirectoryName(directoryName)) { setErrorCode('invalid-name'); return }
    if (!parentPath) { setErrorCode('invalid-parent'); return }
    const jobId = crypto.randomUUID()
    jobRef.current = jobId
    setLoading(true)
    setCancelling(false)
    setProgress(null)
    setErrorCode(null)
    setRecoveryPath(null)
    try {
      const result = await invokeDb<CloneResult>('project-setup:clone', { jobId, repositoryUrl, directoryName, parentPath })
      if (!mounted.current) return
      if (!result.ok) {
        setErrorCode(result.code)
        setRecoveryPath(result.localPath ?? null)
        return
      }
      // Clone already succeeded; a list reload failure must not imply that its
      // destination was removed. Keep the successfully registered project usable.
      const projects = await invokeDb<Project[]>('db:projects:list').catch(() => [...state.projects, result.project])
      if (!mounted.current) return
      dispatch({ type: 'SET_PROJECTS', projects })
      dispatch({ type: 'SET_ACTIVE_PROJECT', project_id: result.project.project_id })
      setIsOpen(false)
      options.onCloned?.(result.project)
    } catch {
      if (mounted.current) setErrorCode('failed')
    } finally {
      jobRef.current = null
      if (mounted.current) { setLoading(false); setCancelling(false) }
    }
  }, [repositoryUrl, directoryName, parentPath, state.projects, dispatch, options.onCloned])

  return {
    isOpen, language, repositoryUrl, setRepositoryUrl, directoryName, setDirectoryName,
    parentPath, chooseParent, loading, cancelling, progress,
    error: errorCode ? getCloneTerms(language).errors[errorCode] : null,
    recoveryPath, recoveryHint: recoveryPath && errorCode !== 'registration' ? getCloneTerms(language).recoveryHint : null,
    open, close, submit, cancel
  }
}

export type CloneProjectState = ReturnType<typeof useCloneProject>
