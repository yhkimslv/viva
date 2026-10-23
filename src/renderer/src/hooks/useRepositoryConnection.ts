import { useCallback, useEffect, useRef, useState } from 'react'
import { invokeDb } from '../ipc'
import type { Project, ProjectFolderInspection } from '../types'

export type RepositoryConnectionInspection = Pick<ProjectFolderInspection, 'isGitRepo' | 'remotes'>

interface ConnectionState {
  projectKey: string | null
  inspection: RepositoryConnectionInspection | null
  loading: boolean
  error: string | null
}

export function useRepositoryConnection(project: Project | null, refreshKey = '') {
  const projectKey = project ? `${project.project_id}\0${project.local_path}` : null
  const localPath = project?.local_path ?? null
  const currentProjectKey = useRef(projectKey)
  currentProjectKey.current = projectKey
  const requestSequence = useRef(0)
  const mounted = useRef(false)
  const [state, setState] = useState<ConnectionState>({
    projectKey: null, inspection: null, loading: false, error: null
  })

  const refresh = useCallback(async (): Promise<void> => {
    // A retained callback from another project must not reset the current banner.
    if (currentProjectKey.current !== projectKey || !mounted.current) return
    const sequence = ++requestSequence.current

    if (!projectKey || !localPath) {
      setState({ projectKey, inspection: null, loading: false, error: null })
      return
    }

    setState({ projectKey, inspection: null, loading: true, error: null })
    try {
      const inspection = await invokeDb<RepositoryConnectionInspection>('project-setup:connection', localPath)
      if (!mounted.current || sequence !== requestSequence.current || currentProjectKey.current !== projectKey) return
      setState({ projectKey, inspection, loading: false, error: null })
    } catch {
      if (!mounted.current || sequence !== requestSequence.current || currentProjectKey.current !== projectKey) return
      // IPC errors can contain paths or credential-bearing URLs. Keep them out of the banner.
      setState({ projectKey, inspection: null, loading: false, error: 'inspection-failed' })
    }
  }, [localPath, projectKey])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      ++requestSequence.current
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh, refreshKey])

  // Mask the previous project before the new effect has had a chance to run.
  const visibleState = state.projectKey === projectKey
    ? state
    : { inspection: null, loading: Boolean(project), error: null }

  return {
    inspection: visibleState.inspection,
    loading: visibleState.loading,
    error: visibleState.error,
    refresh
  }
}
