import { ipcMain, shell, BrowserWindow } from 'electron'
import { clearGithubToken, hasGithubToken, setGithubToken } from '../db/credentials'
import { createGithubService } from '../github/service'

const GITHUB_CLIENT_ID = 'Ov23lihbAdUM2nvHGoip'
const githubService = createGithubService()

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenPollResponse {
  access_token?: string
  error?: string
  error_description?: string
}

let pollTimer: ReturnType<typeof setTimeout> | null = null
let flowGeneration = 0

function cancelPolling(): void {
  flowGeneration += 1
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function notifyRenderer(channel: string, payload?: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, payload)
  })
}

async function pollForToken(
  device_code: string,
  interval: number,
  expiresAt: number,
  generation: number
): Promise<void> {
  if (generation !== flowGeneration) return
  if (Date.now() > expiresAt) {
    cancelPolling()
    notifyRenderer('auth:github:device:error', 'Login timed out. Please try again.')
    return
  }

  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    })
    const data = (await res.json()) as TokenPollResponse
    if (generation !== flowGeneration) return

    if (data.access_token) {
      const validation = await githubService.validateToken(data.access_token)
      if (generation !== flowGeneration) return
      if (validation.status !== 'ok') {
        cancelPolling()
        notifyRenderer(
          'auth:github:device:error',
          validation.reason ?? 'GitHub authorization succeeded, but the token could not be validated.'
        )
        return
      }

      try {
        setGithubToken(data.access_token)
      } catch {
        cancelPolling()
        notifyRenderer('auth:github:device:error', 'Could not store GitHub credentials securely. Please try again.')
        return
      }
      cancelPolling()
      notifyRenderer('auth:github:device:success')
      return
    }

    let nextInterval = interval
    if (data.error === 'slow_down') nextInterval = interval + 5

    if (data.error === 'authorization_pending' || data.error === 'slow_down') {
      pollTimer = setTimeout(
        () => pollForToken(device_code, nextInterval, expiresAt, generation),
        nextInterval * 1000
      )
      return
    }

    // access_denied, expired_token, or unknown
    cancelPolling()
    notifyRenderer(
      'auth:github:device:error',
      data.error === 'access_denied'
        ? 'Authorization was cancelled.'
        : (data.error_description ?? 'Authorization failed. Please try again.')
    )
  } catch {
    if (generation !== flowGeneration) return
    // Network error — retry after interval
    pollTimer = setTimeout(
      () => pollForToken(device_code, interval, expiresAt, generation),
      interval * 1000
    )
  }
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:token:set', async (_event, token: string) => {
    cancelPolling()
    const generation = flowGeneration
    const validation = await githubService.validateToken(token)
    if (generation !== flowGeneration) throw new Error('GitHub connection was cancelled.')

    if (validation.status !== 'ok') {
      throw new Error(validation.reason ?? 'This GitHub token could not be validated.')
    }

    setGithubToken(token)
    return validation
  })

  ipcMain.handle('auth:token:exists', () => {
    return hasGithubToken()
  })

  ipcMain.handle('auth:token:clear', () => {
    cancelPolling()
    clearGithubToken()
  })

  ipcMain.handle('auth:github:device:start', async () => {
    cancelPolling()
    const generation = flowGeneration

    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo' })
    })
    const data = (await res.json()) as DeviceCodeResponse
    if (generation !== flowGeneration) throw new Error('GitHub login was cancelled.')
    if (
      !res.ok || !data.device_code || !data.user_code ||
      data.verification_uri !== 'https://github.com/login/device' ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      !Number.isFinite(data.interval) || data.interval <= 0
    ) {
      throw new Error('GitHub could not start login. Please try again.')
    }

    await shell.openExternal(data.verification_uri)
    if (generation !== flowGeneration) throw new Error('GitHub login was cancelled.')

    const expiresAt = Date.now() + data.expires_in * 1000
    pollTimer = setTimeout(
      () => pollForToken(data.device_code, data.interval, expiresAt, generation),
      data.interval * 1000
    )

    return {
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in
    }
  })

  ipcMain.handle('auth:github:device:cancel', () => {
    cancelPolling()
  })
}
