import chokidar, { FSWatcher } from 'chokidar'
import { BrowserWindow } from 'electron'
import { relative, sep } from 'node:path'
import { invalidateCache } from '../db/statusCache'
import { listProjects } from '../db/projects'

// Map of project_id -> FSWatcher instance
const watchers = new Map<string, FSWatcher>()
const pendingNotifications = new Map<string, ReturnType<typeof setTimeout>>()
const watchedGitEntries = new Set(['HEAD', 'index', 'refs', 'packed-refs', 'config', 'MERGE_HEAD', 'MERGE_MSG'])

function notifyRenderer(project_id: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('db:status:changed', project_id)
  })
}

export function watchProject(project_id: string, local_path: string): void {
  if (watchers.has(project_id)) return

  const watcher = chokidar.watch(local_path, {
    ignoreInitial: true,
    ignored: (candidate: string) => {
      const parts = relative(local_path, candidate).split(sep)
      if (parts[0] === '.git') {
        // Branch switches and staging can change only Git metadata. Watch it,
        // while excluding the object database and logs that create event storms.
        return parts.length > 1 && !watchedGitEntries.has(parts[1])
      }
      // A generated-looking directory may contain tracked source or assets.
      return false
    },
    persistent: true,
    depth: 5
  })

  const invalidate = (): void => {
    invalidateCache(project_id)
    const pending = pendingNotifications.get(project_id)
    if (pending) clearTimeout(pending)
    pendingNotifications.set(project_id, setTimeout(() => {
      pendingNotifications.delete(project_id)
      notifyRenderer(project_id)
    }, 150))
  }

  watcher.on('add', invalidate)
  watcher.on('change', invalidate)
  watcher.on('unlink', invalidate)
  watcher.on('addDir', invalidate)
  watcher.on('unlinkDir', invalidate)

  watchers.set(project_id, watcher)
}

export function stopWatchingProject(project_id: string): void {
  const pending = pendingNotifications.get(project_id)
  if (pending) clearTimeout(pending)
  pendingNotifications.delete(project_id)
  const watcher = watchers.get(project_id)
  if (watcher) {
    watcher.close()
    watchers.delete(project_id)
  }
}

export function startWatchingAllProjects(): void {
  for (const project of listProjects()) {
    watchProject(project.project_id, project.local_path)
  }
}

export function stopAllWatchers(): void {
  for (const [project_id] of watchers) {
    stopWatchingProject(project_id)
  }
}
