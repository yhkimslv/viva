import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloneInput, isCloneDirectoryName, normalizeCloneUrl } from '../../../shared/clone'
import { CloneFailure, cloneGitEnvironment, cloneRepository, cloneSymlinkType, CloneTransportInput } from '../cloneRepository'

const exec = promisify(execFile)
const dirs: string[] = []
async function fixture() {
  const parentPath = await realpath(await mkdtemp(join(tmpdir(), 'viva-clone-test-')))
  dirs.push(parentPath)
  const input: CloneInput = { jobId: 'clone-job-123', repositoryUrl: 'https://github.com/team/project', parentPath, directoryName: 'Project' }
  const registerProject = vi.fn((local_path: string, friendly_name: string) => ({ project_id: 'cloned', local_path, friendly_name, last_accessed: 1 }))
  return { input, registerProject, signal: new AbortController().signal, transport: createRepository }
}
async function createRepository({ destination }: CloneTransportInput): Promise<void> {
  await mkdir(join(destination, '.git'), { recursive: true })
  await writeFile(join(destination, 'README.md'), 'Team project')
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('clone request validation', () => {
  it('accepts GitHub HTTPS repositories and normalizes their origin', () => {
    expect(normalizeCloneUrl('https://github.com/Team/project/')).toBe('https://github.com/Team/project.git')
    expect(normalizeCloneUrl('https://github.com/Team/project.git')).toBe('https://github.com/Team/project.git')
  })
  it.each([
    'file:///tmp/repo', '/tmp/repo', 'ext::sh -c foo', 'git@github.com:team/repo.git',
    'https://token@github.com/team/repo', 'https://github.com.evil.test/team/repo',
    'https://github.com:443/team/repo', 'https://github.com/team/repo?token=secret',
    'https://github.com/team/repo#main', 'https://github.com/team/../repo',
    'https://github.com/team/repo%2fother', 'https://github.com/team/repo/tree/main',
    'http://github.com/team/repo', 'https://github.com/team/.git'
  ])('rejects unsafe or unsupported source %s', (url) => expect(normalizeCloneUrl(url)).toBeNull())
  it.each(['../outside', '..', '.', '.git', '/absolute', 'C:\\project', 'a/b', ' a', 'a ', 'a.', 'NUL', 'COM1.txt', 'a\0b'])('rejects unsafe directory name %s', (name) => {
    expect(isCloneDirectoryName(name)).toBe(false)
  })
})

describe('cloneRepository', () => {
  it('runs real Git with the production isolated environment and portable disabled-hook path', async () => {
    const f = await fixture()
    const options = { cwd: f.input.parentPath, env: cloneGitEnvironment(null) }
    const globalConfig = await exec('git', ['config', '--global', '--list'], options)
    expect(globalConfig.stdout.trim()).toBe('')
    const hooksPath = await exec('git', ['-c', 'core.hooksPath=/dev/null', 'config', '--get', 'core.hooksPath'], options)
    expect(hooksPath.stdout.trim()).toBe('/dev/null')
    await exec('git', ['-c', 'core.hooksPath=/dev/null', 'init', '--initial-branch=main', 'isolated'], options)
    expect((await lstat(join(f.input.parentPath, 'isolated', '.git'))).isDirectory()).toBe(true)
  })
  it('clones a real Git repository through an isolated test transport and only then registers it', async () => {
    const f = await fixture()
    const source = join(f.input.parentPath, 'source')
    await mkdir(source)
    await exec('git', ['init', '--initial-branch=main', source])
    await writeFile(join(source, 'README.md'), 'Repository content')
    await exec('git', ['-C', source, 'add', '.'])
    await exec('git', ['-C', source, '-c', 'user.name=VIVA Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'Initial'])
    const result = await cloneRepository(f.input, { ...f, transport: async ({ destination, repositoryUrl }) => {
      expect(repositoryUrl).toBe('https://github.com/team/project.git')
      expect(f.registerProject).not.toHaveBeenCalled()
      await exec('git', ['clone', '--no-local', '--', source, destination])
    } })
    expect(result.ok).toBe(true)
    expect(await readFile(join(f.input.parentPath, 'Project', 'README.md'), 'utf8')).toBe('Repository content')
    expect(f.registerProject).toHaveBeenCalledExactlyOnceWith(join(f.input.parentPath, 'Project'), 'Project')
    expect((await readdir(f.input.parentPath)).filter((name) => name.startsWith('.viva-clone-'))).toEqual([])
  })
  it('never overwrites an existing empty directory, nonempty directory, file, or symlink', async () => {
    const f = await fixture()
    const destination = join(f.input.parentPath, 'Project')
    for (const type of ['empty', 'full', 'file', 'symlink']) {
      if (type === 'file') await writeFile(destination, 'Keep me')
      else if (type === 'symlink') await symlink(f.input.parentPath, destination)
      else { await mkdir(destination); if (type === 'full') await writeFile(join(destination, 'mine'), 'Keep me') }
      const result = await cloneRepository(f.input, f)
      expect(result).toEqual({ ok: false, code: 'destination-exists' })
      expect(await lstat(destination)).toBeTruthy()
      await rm(destination, { recursive: true, force: true })
    }
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('rejects a symlink in the parent path', async () => {
    const f = await fixture()
    const link = join(f.input.parentPath, 'link')
    await symlink(f.input.parentPath, link)
    expect(await cloneRepository({ ...f.input, parentPath: link }, f)).toEqual({ ok: false, code: 'invalid-parent' })
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('keeps a user file added to the reservation and discards only its own staged clone', async () => {
    const f = await fixture()
    const result = await cloneRepository(f.input, { ...f, transport: async (input) => {
      await createRepository(input)
      await writeFile(join(f.input.parentPath, 'Project', 'user.txt'), 'Do not delete')
    } })
    expect(result).toEqual({ ok: false, code: 'destination-changed' })
    expect(await readFile(join(f.input.parentPath, 'Project', 'user.txt'), 'utf8')).toBe('Do not delete')
    expect(await readdir(f.input.parentPath)).toEqual(['Project'])
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('does not follow a replacement destination symlink or remove it on failure', async () => {
    const f = await fixture()
    const destination = join(f.input.parentPath, 'Project')
    const result = await cloneRepository(f.input, { ...f, transport: async (input) => {
      await createRepository(input)
      await rmdir(destination)
      await symlink(f.input.parentPath, destination)
    } })
    expect(result).toEqual({ ok: false, code: 'destination-changed' })
    expect((await lstat(destination)).isSymbolicLink()).toBe(true)
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('cleans an owned partial clone on failure without registering it', async () => {
    const f = await fixture()
    const result = await cloneRepository(f.input, { ...f, transport: async (input) => {
      await createRepository(input)
      throw new CloneFailure('authentication')
    } })
    expect(result).toEqual({ ok: false, code: 'authentication' })
    expect(await readdir(f.input.parentPath)).toEqual([])
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('cancels before promotion and removes only owned directories', async () => {
    const f = await fixture()
    const controller = new AbortController()
    const result = await cloneRepository(f.input, { ...f, signal: controller.signal, transport: async (input) => {
      await createRepository(input)
      controller.abort()
    } })
    expect(result).toEqual({ ok: false, code: 'cancelled' })
    expect(await readdir(f.input.parentPath)).toEqual([])
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('blocks a second concurrent clone to the same destination', async () => {
    const f = await fixture()
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const done = new Promise<void>((resolve) => { release = resolve })
    const first = cloneRepository(f.input, { ...f, transport: async (input) => { started(); await done; await createRepository(input) } })
    await ready
    expect(await cloneRepository({ ...f.input, jobId: 'second-job' }, f)).toEqual({ ok: false, code: 'busy' })
    release()
    expect((await first).ok).toBe(true)
  })
  it('preserves a completed clone when registration fails and returns its recovery path', async () => {
    const f = await fixture()
    const result = await cloneRepository(f.input, { ...f, registerProject: () => { throw new Error('database failed') } })
    const localPath = join(f.input.parentPath, 'Project')
    expect(result).toEqual({ ok: false, code: 'registration', localPath })
    expect(await readFile(join(localPath, 'README.md'), 'utf8')).toBe('Team project')
  })
  it('uses exclusive file copies and preserves a foreign file arriving during publication', async () => {
    const f = await fixture()
    const localPath = join(f.input.parentPath, 'Project')
    let inserted = false
    const result = await cloneRepository(f.input, { ...f, onProgress: (progress) => {
      if (progress.phase === 'publishing' && !inserted) {
        inserted = true
        writeFileSync(join(localPath, 'README.md'), 'My concurrent file')
      }
    } })
    expect(result).toEqual({ ok: false, code: 'publication', localPath })
    expect(await readFile(join(localPath, 'README.md'), 'utf8')).toBe('My concurrent file')
    expect(await readdir(localPath)).toEqual(['README.md'])
    expect((await readdir(f.input.parentPath)).filter((name) => name.startsWith('.viva-clone-'))).toEqual([])
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('never unlinks a foreign symlink arriving during publication', async () => {
    const f = await fixture()
    const localPath = join(f.input.parentPath, 'Project')
    const keeper = join(f.input.parentPath, 'keeper')
    await writeFile(keeper, 'Protected')
    let inserted = false
    const result = await cloneRepository(f.input, { ...f, onProgress: (progress) => {
      if (progress.phase === 'publishing' && !inserted) {
        inserted = true
        symlinkSync(keeper, join(localPath, 'README.md'))
      }
    } })
    expect(result).toEqual({ ok: false, code: 'publication', localPath })
    expect((await lstat(join(localPath, 'README.md'))).isSymbolicLink()).toBe(true)
    expect(await readFile(keeper, 'utf8')).toBe('Protected')
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('preserves an incomplete destination on cancellation during publication and never registers it', async () => {
    const f = await fixture()
    const controller = new AbortController()
    let publicationEvents = 0
    const result = await cloneRepository(f.input, { ...f, signal: controller.signal, onProgress: (progress) => {
      if (progress.phase === 'publishing' && ++publicationEvents === 2) controller.abort()
    } })
    const localPath = join(f.input.parentPath, 'Project')
    expect(result).toEqual({ ok: false, code: 'cancelled', localPath })
    expect(await readdir(localPath)).toEqual(['README.md'])
    expect(await readFile(join(localPath, 'README.md'), 'utf8')).toBe('Team project')
    expect(await readdir(f.input.parentPath)).toEqual(['Project'])
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('preserves relative repository symlinks without following them during publication', async () => {
    const f = await fixture()
    const result = await cloneRepository(f.input, { ...f, transport: async (input) => {
      await createRepository(input)
      const sourceLink = join(input.destination, 'readme-link')
      await symlink('README.md', sourceLink)
      expect(await cloneSymlinkType(sourceLink, 'win32')).toBe('file')
    } })
    expect(result.ok).toBe(true)
    expect(await readlink(join(f.input.parentPath, 'Project', 'readme-link'))).toBe('README.md')
  })
  it('preserves a directory symlink published before its target using the source target type on Windows', async () => {
    const f = await fixture()
    const localPath = join(f.input.parentPath, 'Project')
    const publishedLink = join(localPath, 'a-directory-link')
    let publishedBeforeTarget = false
    const result = await cloneRepository(f.input, { ...f, transport: async (input) => {
      await createRepository(input)
      await mkdir(join(input.destination, 'z-target'))
      await writeFile(join(input.destination, 'z-target', 'entry.txt'), 'Directory contents')
      const sourceLink = join(input.destination, 'a-directory-link')
      await symlink('z-target', sourceLink, 'dir')
      expect(await cloneSymlinkType(sourceLink, 'win32')).toBe('dir')
      expect(existsSync(join(localPath, 'z-target'))).toBe(false)
    }, onProgress: (progress) => {
      if (progress.phase === 'publishing' && lstatSync(publishedLink, { throwIfNoEntry: false })?.isSymbolicLink() &&
          !existsSync(join(localPath, 'z-target'))) publishedBeforeTarget = true
    } })
    expect(result.ok).toBe(true)
    expect(publishedBeforeTarget).toBe(true)
    expect(await readlink(publishedLink)).toBe('z-target')
    expect(await readFile(join(publishedLink, 'entry.txt'), 'utf8')).toBe('Directory contents')
  })
  it('preserves dangling repository symlinks with the default Windows file link type', async () => {
    const f = await fixture()
    const result = await cloneRepository(f.input, { ...f, transport: async (input) => {
      await createRepository(input)
      const sourceLink = join(input.destination, 'dangling-link')
      await symlink('missing-target', sourceLink, 'file')
      expect(await cloneSymlinkType(sourceLink, 'win32')).toBe('file')
    } })
    const publishedLink = join(f.input.parentPath, 'Project', 'dangling-link')
    expect(result.ok).toBe(true)
    expect((await lstat(publishedLink)).isSymbolicLink()).toBe(true)
    expect(await readlink(publishedLink)).toBe('missing-target')
    expect(existsSync(publishedLink)).toBe(false)
  })
  it('does not register a foreign replacement arriving after the final copy', async () => {
    const f = await fixture()
    const localPath = join(f.input.parentPath, 'Project')
    const movedPath = join(f.input.parentPath, 'Moved-by-user')
    let replaced = false
    const result = await cloneRepository(f.input, { ...f, onProgress: (progress) => {
      if (progress.phase === 'publishing' && !replaced && existsSync(join(localPath, '.git'))) {
        replaced = true
        renameSync(localPath, movedPath)
        mkdirSync(localPath)
        writeFileSync(join(localPath, 'foreign.txt'), 'Unrelated folder')
      }
    } })
    expect(replaced).toBe(true)
    expect(result).toEqual({ ok: false, code: 'publication', localPath })
    expect(await readFile(join(localPath, 'foreign.txt'), 'utf8')).toBe('Unrelated folder')
    expect(await readFile(join(movedPath, 'README.md'), 'utf8')).toBe('Team project')
    expect(f.registerProject).not.toHaveBeenCalled()
  })
  it('strips inherited Git configuration and passes a token through environment only', () => {
    vi.stubEnv('GIT_CONFIG_VALUE_99', 'injected-secret')
    vi.stubEnv('GIT_DIR', '/outside')
    vi.stubEnv('GIT_ASKPASS', '/executable')
    const env = cloneGitEnvironment('test-private-token')
    expect(env.GIT_CONFIG_VALUE_99).toBeUndefined()
    expect(env.GIT_DIR).toBeUndefined()
    expect(env.GIT_ASKPASS).toBeUndefined()
    expect(env.GIT_CONFIG_COUNT).toBe('1')
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraHeader')
    expect(env.GIT_CONFIG_VALUE_0).toContain(Buffer.from('x-access-token:test-private-token').toString('base64'))
    expect(cloneGitEnvironment(null).GIT_CONFIG_COUNT).toBe('0')
    vi.unstubAllEnvs()
  })
})
