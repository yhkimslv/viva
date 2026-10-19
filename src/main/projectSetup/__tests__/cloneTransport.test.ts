import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runGitClone, terminateCloneProcess } from '../cloneRepository'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
let child: EventEmitter & { stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.clearAllMocks()
  child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), kill: vi.fn() })
  mocks.spawn.mockReturnValue(child)
})
function input() {
  return { repositoryUrl: 'https://github.com/team/repository.git', destination: '/new/repository',
    token: 'private-test-token', signal: new AbortController().signal, onProgress: vi.fn() }
}
describe('Git clone transport', () => {
  it('keeps credentials out of arguments and forwards only parsed numeric progress', async () => {
    const i = input()
    const pending = runGitClone(i)
    const [command, args, options] = mocks.spawn.mock.calls[0]
    expect(command).toBe('git')
    expect(args).toContain('http.followRedirects=false')
    expect(args).toContain('core.hooksPath=/dev/null')
    expect(args).toContain('protocol.allow=never')
    expect(args).toContain('protocol.https.allow=always')
    expect(args).toContain('--no-recurse-submodules')
    expect(args.join(' ')).not.toContain(i.token)
    expect(options.env.GIT_CONFIG_VALUE_0).toContain(Buffer.from('x-access-token:private-test-token').toString('base64'))
    child.stderr.write('remote: secret private-test-token\nReceiving objects:  42% (42/100)\r')
    child.stderr.write('Resolving deltas: 100% (12/12)\n')
    child.emit('close', 0)
    await pending
    expect(i.onProgress.mock.calls).toEqual([[{ phase: 'receiving', percent: 42 }], [{ phase: 'resolving', percent: 100 }]])
    expect(JSON.stringify(i.onProgress.mock.calls)).not.toContain('secret')
  })
  it('redacts authentication failures to a fixed error code', async () => {
    const pending = runGitClone(input())
    child.stderr.write('fatal: Authentication failed for https://private-test-token@github.com/team/repository')
    child.emit('close', 128)
    await expect(pending).rejects.toMatchObject({ code: 'authentication', message: 'authentication' })
  })
  it('kills the child process on cancellation and waits for process completion', async () => {
    const controller = new AbortController()
    const pending = runGitClone({ ...input(), signal: controller.signal })
    controller.abort()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })
  it('reports a missing Git binary as an actionable error', async () => {
    const pending = runGitClone(input())
    child.emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }))
    await expect(pending).rejects.toMatchObject({ code: 'git-unavailable' })
  })
  it('terminates Git and its HTTPS descendants on Windows through the system taskkill utility', () => {
    const killer = new EventEmitter()
    mocks.spawn.mockReturnValueOnce(killer)
    const target = { pid: 1234, kill: vi.fn() }
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    terminateCloneProcess(target, 'SIGTERM', 'win32')
    expect(mocks.spawn).toHaveBeenCalledWith('C:\\Windows\\System32\\taskkill.exe', ['/PID', '1234', '/T', '/F'], {
      stdio: 'ignore', windowsHide: true
    })
    expect(target.kill).not.toHaveBeenCalled()
    killer.emit('close', 0)
    expect(target.kill).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
  it('falls back to direct cancellation if Windows taskkill is unavailable', () => {
    const killer = new EventEmitter()
    mocks.spawn.mockReturnValueOnce(killer)
    const target = { pid: 1234, kill: vi.fn() }
    terminateCloneProcess(target, 'SIGKILL', 'win32')
    killer.emit('error', new Error('taskkill unavailable'))
    expect(target.kill).toHaveBeenCalledWith('SIGKILL')
  })
})
