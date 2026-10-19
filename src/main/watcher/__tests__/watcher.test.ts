import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  watch: vi.fn(), on: vi.fn(), close: vi.fn(), send: vi.fn(), invalidate: vi.fn(),
  handlers: new Map<string, () => void>()
}))
vi.mock('chokidar', () => ({ default: { watch: mocks.watch } }))
vi.mock('electron', () => ({ BrowserWindow: {
  getAllWindows: () => [{ webContents: { send: mocks.send } }]
} }))
vi.mock('../../db/statusCache', () => ({ invalidateCache: mocks.invalidate }))
vi.mock('../../db/projects', () => ({ listProjects: () => [] }))
import { stopAllWatchers, stopWatchingProject, watchProject } from '../index'

describe('project watchers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.on.mockImplementation((event, handler) => { mocks.handlers.set(event, handler) })
    mocks.watch.mockReturnValue({ on: mocks.on, close: mocks.close })
  })
  afterEach(() => { stopAllWatchers(); vi.useRealTimers() })

  it('watches dotfiles, branch metadata and tracked build paths but skips Git objects', () => {
    const root = join(process.cwd(), 'demo')
    watchProject('project-1', root)
    const ignored = mocks.watch.mock.calls[0][1].ignored as (path: string) => boolean

    for (const file of ['.env', '.gitignore', '.github/workflows/ci.yml', '.git', '.git/HEAD', '.git/index', '.git/refs/heads/feature/demo', 'build/source.js', 'dist/tracked.css', 'out/asset.png']) {
      expect(ignored(join(root, file))).toBe(false)
    }
    for (const file of ['.git/objects', '.git/objects/ab/hash', '.git/logs/HEAD']) {
      expect(ignored(join(root, file))).toBe(true)
    }
  })

  it('invalidates immediately and sends one notification for a burst of file events', async () => {
    watchProject('project-1', process.cwd())
    mocks.handlers.get('change')!()
    mocks.handlers.get('add')!()
    mocks.handlers.get('unlink')!()

    expect(mocks.invalidate).toHaveBeenCalledTimes(3)
    expect(mocks.send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(150)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith('db:status:changed', 'project-1')
  })

  it('cancels a pending notification when the project is removed', async () => {
    watchProject('project-1', process.cwd())
    mocks.handlers.get('change')!()
    stopWatchingProject('project-1')
    await vi.advanceTimersByTimeAsync(150)

    expect(mocks.close).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
