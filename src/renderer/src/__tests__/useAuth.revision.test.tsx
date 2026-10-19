// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'

const { invokeDb, addToast } = vi.hoisted(() => ({ invokeDb: vi.fn(), addToast: vi.fn() }))
vi.mock('../ipc', () => ({ invokeDb }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ addToast }) }))

describe('GitHub account revisions', () => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.clear()
    invokeDb.mockImplementation(async (channel) => channel === 'auth:token:exists' ? true : { status: 'ok', accountLogin: 'lead' })
    Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: {
      on: (channel: string, callback: (...args: unknown[]) => void) => { listeners.set(channel, callback) },
      removeAllListeners: vi.fn()
    } } })
  })

  it('invalidates account-dependent data for device and manual connections, even when already connected', async () => {
    const { result } = renderHook(() => useAuth())
    await act(async () => {})
    expect(result.current.tokenExists).toBe(true)
    act(() => { listeners.get('auth:github:device:success')!() })
    expect(result.current.connectionRevision).toBe(1)
    await act(async () => { await result.current.saveToken('test-only-token') })
    expect(result.current.connectionRevision).toBe(2)
    await act(async () => { await result.current.clearToken() })
    expect(result.current.connectionRevision).toBe(3)
    expect(result.current.tokenExists).toBe(false)
  })
})
