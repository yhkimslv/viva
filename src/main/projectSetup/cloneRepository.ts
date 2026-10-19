import { spawn, ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readdir, readlink, realpath, rm, rmdir, stat, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, parse, resolve, sep, win32 } from 'node:path'
import {
  CloneErrorCode, CloneInput, CloneProgress, ClonedProject, CloneResult,
  isCloneDirectoryName, normalizeCloneUrl
} from '../../shared/clone'

export class CloneFailure extends Error {
  constructor(public readonly code: CloneErrorCode) { super(code) }
}

export interface CloneTransportInput {
  repositoryUrl: string
  destination: string
  token: string | null
  signal: AbortSignal
  onProgress: (progress: Omit<CloneProgress, 'jobId'>) => void
}

export interface CloneDependencies {
  registerProject: (localPath: string, name: string) => ClonedProject
  token?: string | null
  signal: AbortSignal
  onProgress?: (progress: CloneProgress) => void
  // Tests replace only the transport; all production validation and filesystem
  // ownership checks still run against real directories.
  transport?: (input: CloneTransportInput) => Promise<void>
}

const destinations = new Set<string>()

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CloneFailure('cancelled')
}

async function canonicalParent(path: unknown): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
    throw new CloneFailure('invalid-parent')
  }
  // Reject symlinks at every path component, rather than silently following a
  // selected directory to another location during clone or cleanup.
  const normalized = resolve(normalize(path))
  let current = parse(normalized).root
  for (const part of normalized.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new CloneFailure('invalid-parent')
  }
  if (await realpath(normalized) !== normalized) throw new CloneFailure('invalid-parent')
  return normalized
}

function filesystemCode(error: unknown): CloneErrorCode {
  if (error instanceof CloneFailure) return error.code
  const code = (error as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'disk-space'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'permission'
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 'destination-exists'
  return 'failed'
}

export function cloneGitEnvironment(token: string | null): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return {
    ...env,
    // Git for Windows maps /dev/null to nul itself. Node's os.devNull value
    // (\\.\nul) is not a valid configuration path for Git's compatibility layer.
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    GIT_CONFIG_COUNT: token ? '1' : '0',
    ...(token ? {
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`
    } : {})
  }
}

export function terminateCloneProcess(child: Pick<ChildProcess, 'pid' | 'kill'>, signal: NodeJS.Signals, platform = process.platform): void {
  if (platform === 'win32' && child.pid) {
    // Node's child.kill does not kill git-remote-https on Windows. Use the OS
    // utility directly (never a shell or a PATH lookup) to terminate the tree.
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
    const killer = spawn(win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true
    })
    killer.once('error', () => { child.kill(signal) })
    killer.once('close', (code) => { if (code !== 0) child.kill(signal) })
    return
  }
  if (platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, signal); return } catch { /* process may already have exited */ }
  }
  child.kill(signal)
}

export function runGitClone(input: CloneTransportInput): Promise<void> {
  checkCancelled(input.signal)
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', [
      '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null',
      '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
      '-c', 'http.followRedirects=false', '-c', 'submodule.recurse=false',
      'clone', '--progress', '--no-recurse-submodules', '--template=', '--',
      input.repositoryUrl, input.destination
    ], {
      cwd: dirname(input.destination),
      env: { ...cloneGitEnvironment(input.token), GIT_CEILING_DIRECTORIES: dirname(input.destination) },
      stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
      // Git's HTTPS helper must be cancelled with its parent rather than left
      // downloading after the dialog says cancellation is in progress.
      detached: process.platform !== 'win32'
    })
    let failureCode: CloneErrorCode = 'failed'
    let killed = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const abort = (): void => {
      killed = true
      terminateCloneProcess(child, 'SIGTERM')
      killTimer = setTimeout(() => terminateCloneProcess(child, 'SIGKILL'), 2000)
      killTimer.unref()
    }
    input.signal.addEventListener('abort', abort, { once: true })
    if (input.signal.aborted) abort()
    // Do not retain or forward raw Git output: it may include credential data,
    // server-controlled text, or local paths. Only fixed phase names + numbers.
    child.stderr.on('data', (chunk: Buffer) => {
      const output = chunk.toString()
      if (/authentication failed|could not read Username|repository not found|403|401/i.test(output)) failureCode = 'authentication'
      else if (/could not resolve host|unable to access|connection|timed out/i.test(output)) failureCode = 'network'
      else if (/no space left|disk quota/i.test(output)) failureCode = 'disk-space'
      else if (/permission denied|read-only file system/i.test(output)) failureCode = 'permission'
      const matches = output.matchAll(/(Receiving objects|Resolving deltas|Updating files|Checking out files):\s+(\d+)%/g)
      for (const match of matches) {
        const phase = match[1] === 'Receiving objects' ? 'receiving' : match[1] === 'Resolving deltas' ? 'resolving' : 'checkout'
        input.onProgress({ phase, percent: Math.max(0, Math.min(100, Number(match[2]))) })
      }
    })
    const finish = (): void => {
      input.signal.removeEventListener('abort', abort)
      if (killTimer) clearTimeout(killTimer)
    }
    child.once('error', (error: NodeJS.ErrnoException) => {
      finish()
      reject(new CloneFailure(input.signal.aborted ? 'cancelled' : error.code === 'ENOENT' ? 'git-unavailable' : filesystemCode(error)))
    })
    child.once('close', (code) => {
      finish()
      if (killed || input.signal.aborted) reject(new CloneFailure('cancelled'))
      else if (code === 0) resolvePromise()
      else reject(new CloneFailure(failureCode))
    })
  })
}

type DirectoryIdentity = Pick<Awaited<ReturnType<typeof lstat>>, 'ino' | 'dev'>

async function assertOwnedDirectory(path: string, identity: DirectoryIdentity): Promise<void> {
  const current = await lstat(path)
  if (!current.isDirectory() || current.isSymbolicLink() || current.ino !== identity.ino || current.dev !== identity.dev) {
    throw new CloneFailure('destination-changed')
  }
}

export async function cloneSymlinkType(source: string, platform = process.platform): Promise<'dir' | 'file' | undefined> {
  if (platform !== 'win32') return undefined
  try {
    // The destination target may not have been published yet. Inspect the
    // source target so Windows creates a directory link with the correct type.
    return (await stat(source)).isDirectory() ? 'dir' : 'file'
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // Match Node's default for a dangling target while preserving the link.
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'file'
    throw error
  }
}

// Node has no portable atomic directory rename-without-replacement, and
// Windows cannot rename over even an empty reservation directory. Keep the
// reservation, create every entry exclusively, and never remove destination
// contents on failure. A user file arriving during publication always wins.
async function publishTree(
  source: string, destination: string, identity: DirectoryIdentity,
  root: string, rootIdentity: DirectoryIdentity, signal: AbortSignal, onEntry: () => void
): Promise<void> {
  const entries = await readdir(source)
  // Publish metadata last, so an interrupted destination does not appear to be
  // a ready Git repository. Registration only occurs after the entire copy.
  entries.sort((a, b) => Number(a === '.git') - Number(b === '.git') || a.localeCompare(b))
  for (const name of entries) {
    checkCancelled(signal)
    await assertOwnedDirectory(root, rootIdentity)
    await assertOwnedDirectory(destination, identity)
    const src = join(source, name)
    const dest = join(destination, name)
    const stat = await lstat(src)
    if (stat.isDirectory()) {
      await mkdir(dest, { mode: stat.mode & 0o777 })
      const childIdentity = await lstat(dest)
      await publishTree(src, dest, childIdentity, root, rootIdentity, signal, onEntry)
    } else if (stat.isSymbolicLink()) {
      // symlink fails with EEXIST and never unlinks an existing destination.
      await symlink(await readlink(src), dest, await cloneSymlinkType(src))
    } else if (stat.isFile()) {
      // The exclusive flag is essential even after a prior existence check:
      // another process can create a file while the copy is being scheduled.
      await copyFile(src, dest, constants.COPYFILE_EXCL)
    } else {
      throw new CloneFailure('publication')
    }
    onEntry()
  }
}

export async function cloneRepository(input: CloneInput, dependencies: CloneDependencies): Promise<CloneResult> {
  const repositoryUrl = normalizeCloneUrl(input?.repositoryUrl)
  if (!repositoryUrl) return { ok: false, code: 'invalid-url' }
  if (!isCloneDirectoryName(input.directoryName)) return { ok: false, code: 'invalid-name' }
  let parent: string
  try { parent = await canonicalParent(input.parentPath) }
  catch { return { ok: false, code: 'invalid-parent' } }
  const destination = join(parent, input.directoryName)
  if (destinations.has(destination)) return { ok: false, code: 'busy' }
  destinations.add(destination)
  let reservation: Awaited<ReturnType<typeof lstat>> | undefined
  let temp: string | undefined
  let tempStat: Awaited<ReturnType<typeof lstat>> | undefined
  let finalized = false
  let publishing = false
  const progress = (value: Omit<CloneProgress, 'jobId'>): void => dependencies.onProgress?.({ ...value, jobId: input.jobId })
  try {
    checkCancelled(dependencies.signal)
    progress({ phase: 'preparing' })
    // Exclusive mkdir reserves the destination across app instances. Keep this
    // same directory throughout download and publication on every platform.
    await mkdir(destination, { mode: 0o700 })
    reservation = await lstat(destination)
    temp = await mkdtemp(join(parent, '.viva-clone-'))
    tempStat = await lstat(temp)
    const staging = join(temp, 'repository')
    await (dependencies.transport ?? runGitClone)({
      repositoryUrl, destination: staging, token: dependencies.token ?? null,
      signal: dependencies.signal, onProgress: progress
    })
    checkCancelled(dependencies.signal)
    const stagingDirectory = await lstat(staging)
    if (!stagingDirectory.isDirectory() || stagingDirectory.isSymbolicLink()) throw new CloneFailure('failed')
    const gitDirectory = await lstat(join(staging, '.git'))
    if (!gitDirectory.isDirectory() || gitDirectory.isSymbolicLink()) throw new CloneFailure('failed')
    if (await canonicalParent(parent) !== parent) throw new CloneFailure('destination-changed')
    const target = await lstat(destination)
    if (!target.isDirectory() || target.isSymbolicLink() || target.ino !== reservation.ino || target.dev !== reservation.dev ||
        (await readdir(destination)).length > 0) throw new CloneFailure('destination-changed')
    publishing = true
    progress({ phase: 'publishing' })
    await publishTree(staging, destination, reservation, destination, reservation, dependencies.signal, () => progress({ phase: 'publishing' }))
    checkCancelled(dependencies.signal)
    // Verify ownership once more after the last copy and progress callback;
    // registration must never attach a replacement directory at this path.
    progress({ phase: 'registering' })
    if (await canonicalParent(parent) !== parent) throw new CloneFailure('destination-changed')
    await assertOwnedDirectory(destination, reservation)
    checkCancelled(dependencies.signal)
    finalized = true
    try {
      return { ok: true, project: dependencies.registerProject(destination, input.directoryName) }
    } catch {
      return { ok: false, code: 'registration', localPath: destination }
    }
  } catch (error) {
    const hasContents = publishing && (await readdir(destination).catch(() => [])).length > 0
    return {
      ok: false,
      code: dependencies.signal.aborted ? 'cancelled' : publishing ? 'publication' : filesystemCode(error),
      ...(hasContents ? { localPath: destination } : {})
    }
  } finally {
    if (temp && tempStat) {
      const current = await lstat(temp).catch(() => null)
      if (current && current.isDirectory() && !current.isSymbolicLink() && current.ino === tempStat.ino && current.dev === tempStat.dev) {
        await rm(temp, { recursive: true, force: true }).catch(() => {})
      }
    }
    if (!finalized && reservation) {
      const current = await lstat(destination).catch(() => null)
      if (current && current.isDirectory() && !current.isSymbolicLink() && current.ino === reservation.ino && current.dev === reservation.dev) {
        // Never recursively delete a destination: a user may have put files in
        // the reservation while the network request was running.
        await rmdir(destination).catch(() => {})
      }
    }
    destinations.delete(destination)
  }
}
