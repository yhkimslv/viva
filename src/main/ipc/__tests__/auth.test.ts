import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  setToken: vi.fn(), clearToken: vi.fn(), validate: vi.fn(),
  send: vi.fn(), openExternal: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) },
  shell: { openExternal: mocks.openExternal },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: mocks.send } }] }
}))
vi.mock('../../db/credentials', () => ({
  setGithubToken: mocks.setToken, clearGithubToken: mocks.clearToken, hasGithubToken: () => false
}))
vi.mock('../../github/service', () => ({
  createGithubService: () => ({ validateToken: mocks.validate })
}))
import { registerAuthHandlers } from '../auth'

function call(channel: string, ...args: unknown[]): any {
  return mocks.handlers.get(channel)!(undefined, ...args)
}

function deviceResponse(): Response {
  return new Response(JSON.stringify({
    device_code: 'device-1', user_code: 'TEST-CODE',
    verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5
  }))
}

describe('GitHub login cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    registerAuthHandlers()
    call('auth:github:device:cancel')
    mocks.validate.mockResolvedValue({ status: 'ok', accountLogin: 'tester', reason: null })
    mocks.openExternal.mockResolvedValue(undefined)
  })

  afterEach(() => {
    call('auth:github:device:cancel')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not save a token returned by an in-flight poll after cancel', async () => {
    let finish!: (response: Response) => void
    const fetchMock = vi.fn().mockResolvedValueOnce(deviceResponse())
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    await call('auth:github:device:start')
    await vi.advanceTimersByTimeAsync(5000)
    call('auth:github:device:cancel')
    finish(new Response(JSON.stringify({ access_token: 'test-token' })))
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.setToken).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not reconnect after disconnect during token validation', async () => {
    let finish!: (value: { status: string }) => void
    mocks.validate.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(deviceResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token' }))))
    await call('auth:github:device:start')
    await vi.advanceTimersByTimeAsync(5000)
    call('auth:token:clear')
    finish({ status: 'ok' })
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.clearToken).toHaveBeenCalledOnce()
    expect(mocks.setToken).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('does not open a browser or schedule polling for a cancelled start request', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { finish = resolve })))
    const start = call('auth:github:device:start')
    const rejection = expect(start).rejects.toThrow('cancelled')
    call('auth:github:device:cancel')
    finish(deviceResponse())
    await rejection

    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a malformed device response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad_verification_code' }))))

    await expect(call('auth:github:device:start')).rejects.toThrow('could not start login')

    expect(mocks.openExternal).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('saves and announces a valid login once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(deviceResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-token' }))))
    await call('auth:github:device:start')
    await vi.advanceTimersByTimeAsync(5000)

    expect(mocks.setToken).toHaveBeenCalledTimes(1)
    expect(mocks.setToken).toHaveBeenCalledWith('test-token')
    expect(mocks.send).toHaveBeenCalledWith('auth:github:device:success', undefined)
    expect(vi.getTimerCount()).toBe(0)
  })
})
