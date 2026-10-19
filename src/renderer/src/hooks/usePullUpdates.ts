import { useCallback, useEffect, useRef, useState } from 'react'
import { PullUpdatesPreview } from '../types'

type InvokeGit = <T>(channel: string, ...args: unknown[]) => Promise<T>

interface UsePullUpdatesOptions {
  activeProjectId: string | null
  enabled: boolean
  currentBranch: string | null
  invokeGit: InvokeGit
  pull: () => Promise<unknown>
  refreshStatus: () => Promise<void>
}

interface UsePullUpdatesResult {
  preview: PullUpdatesPreview | null
  loading: boolean
  error: string | null
  showDialog: boolean
  loadPreview: (refreshAfter?: boolean) => Promise<PullUpdatesPreview | null>
  requestPull: () => Promise<void>
  confirmPull: () => void
  close: () => void
  reset: () => void
}

function getPreviewFingerprint(preview: PullUpdatesPreview): string {
  return (
    preview.latest_remote_hash ||
    `${preview.remote_name}/${preview.branch_name}:${preview.behind_count}`
  )
}

export function usePullUpdates({
  activeProjectId,
  enabled,
  currentBranch,
  invokeGit,
  pull,
  refreshStatus
}: UsePullUpdatesOptions): UsePullUpdatesResult {
  const [preview, setPreview] = useState<PullUpdatesPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDialog, setShowDialog] = useState(false)
  const lastShownRef = useRef<Record<string, string>>({})
  const contextKey = JSON.stringify([activeProjectId, currentBranch])
  const contextRef = useRef(contextKey)
  contextRef.current = contextKey
  const requestRef = useRef(0)
  const previewContextRef = useRef<string | null>(null)
  const pullingRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current += 1
    }
  }, [])

  const reset = useCallback((): void => {
    requestRef.current += 1
    previewContextRef.current = null
    setPreview(null)
    setError(null)
    setLoading(false)
    setShowDialog(false)
  }, [])

  useEffect(reset, [contextKey, reset])

  const loadPreview = useCallback(
    async (refreshAfter = false): Promise<PullUpdatesPreview | null> => {
      if (!activeProjectId || !mountedRef.current || contextRef.current !== contextKey) return null

      const request = ++requestRef.current
      const isCurrent = (): boolean =>
        mountedRef.current && contextRef.current === contextKey && requestRef.current === request

      setLoading(true)
      setError(null)

      try {
        const nextPreview = await invokeGit<PullUpdatesPreview>(
          'git:pull:preview',
          activeProjectId,
          20
        )
        if (!isCurrent()) return null
        previewContextRef.current = contextKey
        setPreview(nextPreview)
        if (refreshAfter) {
          await refreshStatus()
        }
        if (!isCurrent()) return null
        return nextPreview
      } catch (caught) {
        if (!isCurrent()) return null
        previewContextRef.current = null
        setPreview(null)
        const message =
          (caught as { message?: string })?.message ?? 'Could not load incoming updates.'
        setError(message)
        return null
      } finally {
        if (isCurrent()) setLoading(false)
      }
    },
    [activeProjectId, contextKey, invokeGit, refreshStatus]
  )

  const requestPull = useCallback(async (): Promise<void> => {
    const nextPreview = await loadPreview(true)
    if (!mountedRef.current || contextRef.current !== contextKey || !nextPreview) return
    if (nextPreview && nextPreview.behind_count > 0) {
      lastShownRef.current[contextKey] = getPreviewFingerprint(nextPreview)
      setShowDialog(true)
      return
    }

  }, [contextKey, loadPreview])

  const confirmPull = useCallback((): void => {
    if (
      pullingRef.current || !showDialog || !preview || preview.behind_count <= 0 ||
      previewContextRef.current !== contextKey || contextRef.current !== contextKey
    ) return
    pullingRef.current = true
    setShowDialog(false)
    void Promise.resolve().then(pull).catch((caught) => {
      if (!mountedRef.current || contextRef.current !== contextKey) return
      setError((caught as { message?: string })?.message ?? 'Could not get incoming updates.')
    }).finally(() => {
      pullingRef.current = false
    })
  }, [contextKey, preview, pull, showDialog])

  const close = useCallback((): void => {
    setShowDialog(false)
  }, [])

  useEffect(() => {
    if (!activeProjectId || !enabled || !currentBranch) return

    let cancelled = false
    let checking = false

    const checkIncomingUpdates = async (): Promise<void> => {
      if (checking || cancelled || showDialog || pullingRef.current) return
      checking = true
      try {
        const nextPreview = await loadPreview()
        if (cancelled || !nextPreview || nextPreview.behind_count <= 0) return

        const fingerprint = getPreviewFingerprint(nextPreview)
        if (lastShownRef.current[contextKey] === fingerprint) return

        lastShownRef.current[contextKey] = fingerprint
        setShowDialog(true)
      } finally {
        checking = false
      }
    }

    void checkIncomingUpdates()
    const interval = window.setInterval(() => {
      void checkIncomingUpdates()
    }, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeProjectId, contextKey, currentBranch, enabled, loadPreview, showDialog])

  return {
    preview,
    loading,
    error,
    showDialog,
    loadPreview,
    requestPull,
    confirmPull,
    close,
    reset
  }
}
