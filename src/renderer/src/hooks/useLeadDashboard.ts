import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardSnapshot } from '../../../shared/dashboard'
import { invokeDb } from '../ipc'

export function useLeadDashboard(projectId: string | null, enabled: boolean, contextKey: string) {
  const selection = JSON.stringify([projectId, enabled, contextKey])
  const currentSelection = useRef(selection)
  currentSelection.current = selection
  const sequence = useRef(0)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const [state, setState] = useState<{
    selection: string
    snapshot: DashboardSnapshot | null
    loading: boolean
    error: string | null
  }>({ selection, snapshot: null, loading: false, error: null })

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; sequence.current += 1 }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!projectId || !enabled || currentSelection.current !== selection || !mounted.current) return
    const request = ++sequence.current
    inFlight.current = true
    const isCurrent = (): boolean => mounted.current && currentSelection.current === selection && sequence.current === request
    setState((current) => ({
      selection, snapshot: current.selection === selection ? current.snapshot : null,
      loading: true, error: null
    }))
    try {
      const snapshot = await invokeDb<DashboardSnapshot>('dashboard:get', projectId, true)
      if (isCurrent()) setState({ selection, snapshot, loading: false, error: null })
    } catch (caught) {
      if (isCurrent()) setState((current) => ({
        ...current, loading: false,
        error: (caught as { message?: string })?.message || 'Could not load the team dashboard.'
      }))
    } finally {
      if (sequence.current === request) inFlight.current = false
    }
  }, [enabled, projectId, selection])

  useEffect(() => {
    sequence.current += 1
    inFlight.current = false
    setState({ selection, snapshot: null, loading: false, error: null })
    if (!enabled || !projectId) return
    void refresh()
    const interval = window.setInterval(() => {
      if (!document.hidden && !inFlight.current) void refresh()
    }, 300_000)
    return () => { sequence.current += 1; window.clearInterval(interval) }
  }, [enabled, projectId, refresh, selection])

  const visible = state.selection === selection
    ? state
    : { snapshot: null, loading: enabled, error: null }
  return { ...visible, refresh }
}
