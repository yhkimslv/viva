import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'

// Release smoke tests run the real installed executable. Apply their explicit
// profile before electron-store modules load, leaving the normal profile alone.
const profileDirectory = process.env.VIVA_USER_DATA_DIR
if (profileDirectory) {
  if (!isAbsolute(profileDirectory)) throw new Error('VIVA_USER_DATA_DIR must be an absolute path')
  mkdirSync(profileDirectory, { recursive: true, mode: 0o700 })
  app.setPath('userData', profileDirectory)
  app.setPath('sessionData', profileDirectory)
}
