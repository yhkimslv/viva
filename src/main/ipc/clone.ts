import { ipcMain } from 'electron'
import { CloneInput, CloneResult } from '../../shared/clone'
import { getGithubToken } from '../db/credentials'
import { cloneRepository } from '../projectSetup/cloneRepository'
import { registerProjectForUse } from './projects'

export function registerCloneHandlers(): void {
  const jobs = new Map<string, { senderId: number; controller: AbortController }>()
  ipcMain.handle('project-setup:clone', async (event, input: CloneInput): Promise<CloneResult> => {
    if (!input || typeof input.jobId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(input.jobId)) {
      return { ok: false, code: 'failed' }
    }
    // One clone per renderer prevents an accidental double submit and unbounded
    // child processes. Progress and cancellation remain scoped to the owner.
    if (jobs.has(input.jobId) || [...jobs.values()].some((job) => job.senderId === event.sender.id)) {
      return { ok: false, code: 'busy' }
    }
    const controller = new AbortController()
    jobs.set(input.jobId, { senderId: event.sender.id, controller })
    const onDestroyed = (): void => controller.abort()
    event.sender.once('destroyed', onDestroyed)
    let lastProgressTime = 0
    let lastPhase = ''
    try {
      return await cloneRepository(input, {
        token: getGithubToken(), signal: controller.signal, registerProject: registerProjectForUse,
        onProgress: (progress) => {
          const now = Date.now()
          if (progress.phase === lastPhase && now - lastProgressTime < 100 && progress.percent !== 100) return
          lastPhase = progress.phase
          lastProgressTime = now
          if (!event.sender.isDestroyed()) event.sender.send('project-setup:clone-progress', progress)
        }
      })
    } catch {
      return { ok: false, code: 'failed' }
    } finally {
      event.sender.removeListener('destroyed', onDestroyed)
      jobs.delete(input.jobId)
    }
  })
  ipcMain.handle('project-setup:clone-cancel', (event, jobId: string) => {
    const job = jobs.get(jobId)
    if (!job || job.senderId !== event.sender.id) return false
    job.controller.abort()
    return true
  })
}
