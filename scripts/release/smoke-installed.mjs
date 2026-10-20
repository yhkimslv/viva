import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

const usage = `Usage: node scripts/release/smoke-installed.mjs <dist-directory|VIVA.app|VIVA.exe|installer.dmg>
  --artifacts-dir <path>    Keep screenshots, startup state, and native command logs here
  --expect-git <present|missing>  Expected Git prerequisite state (default: present)
  --without-system-git     Launch with an empty PATH to test a clean machine
  --allow-installer        Allow an NSIS install outside GitHub Actions; use a disposable VM
  --help

The dist-directory form verifies and copies the macOS DMG, or silently installs
the Windows NSIS installer. Windows installer runs are restricted to disposable
GitHub Actions runners unless --allow-installer is supplied. Each app launch uses
a fresh, verified VIVA_USER_DATA_DIR and the real packaged executable.`

export function parseArguments(args) {
  const options = { expectGit: 'present', withoutSystemGit: false, allowInstaller: false }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--help') options.help = true
    else if (argument === '--without-system-git') options.withoutSystemGit = true
    else if (argument === '--allow-installer') options.allowInstaller = true
    else if (argument === '--artifacts-dir' || argument === '--expect-git') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
      options[argument === '--artifacts-dir' ? 'artifactsDir' : 'expectGit'] = value
    } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`)
    else if (options.target) throw new Error('Specify exactly one package or distribution directory.')
    else options.target = resolve(argument)
  }
  if (!['present', 'missing'].includes(options.expectGit)) throw new Error('--expect-git must be present or missing.')
  if (!options.help && !options.target) throw new Error(usage)
  return options
}

export async function findInstaller(directory, platform) {
  const pattern = platform === 'win32' ? /^VIVA-.+-windows-x64-setup\.exe$/i : /^VIVA.*\.dmg$/i
  const candidates = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(directory, entry.name))
  assert.equal(candidates.length, 1, `Expected one ${platform === 'win32' ? 'Windows x64 NSIS installer' : 'VIVA DMG'} in ${directory}; found ${candidates.length}. Use a clean output directory.`)
  return candidates[0]
}

export async function requireIsolationHook(asarPath) {
  // Refuse to launch an older package even on a developer's machine. Checking
  // only after launch would be too late: electron-store loads during imports.
  const archive = await readFile(asarPath)
  assert.ok(archive.includes(Buffer.from('VIVA_USER_DATA_DIR')),
    'Package lacks the early VIVA_USER_DATA_DIR hook. Rebuild before running a local smoke test.')
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

function deadline(promise, timeout, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout) })
  ]).finally(() => clearTimeout(timer))
}

async function killOwnedProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const taskkill = join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'taskkill.exe')
    await new Promise((done) => {
      const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.once('error', () => { child.kill(); done() })
      killer.once('close', done)
    })
  } else {
    // Playwright and native commands below launch a detached process group.
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}

async function command(executable, args, logPath, options = {}) {
  const output = createWriteStream(logPath, { flags: 'a' })
  output.write(`${JSON.stringify({ executable, args })}\n`)
  const child = spawn(executable, args, {
    windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], ...options
  })
  child.stdout.pipe(output, { end: false })
  child.stderr.pipe(output, { end: false })
  try {
    const result = await deadline(new Promise((resolveResult, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolveResult({ code, signal }))
    }), 120_000, `${basename(executable)} timed out; see ${logPath}`)
    output.write(`${JSON.stringify(result)}\n`)
    assert.equal(result.code, 0, `${basename(executable)} failed (${result.code ?? result.signal}); see ${logPath}`)
  } finally {
    await killOwnedProcess(child)
    output.end()
  }
}

async function normalizePath(path) {
  const normalized = await realpath(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function executableInBundle(bundle, artifactsDir) {
  const plist = join(bundle, 'Contents', 'Info.plist')
  const log = join(artifactsDir, 'bundle-info.log')
  const chunks = []
  const child = spawn('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => chunks.push(chunk))
  try {
    await deadline(new Promise((done, reject) => {
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? done() : reject(new Error(`Cannot read ${plist}`)))
    }), 15_000, 'Reading macOS bundle executable timed out')
  } finally { await killOwnedProcess(child) }
  const name = Buffer.concat(chunks).toString().trim()
  assert.ok(name && !name.includes('/') && !name.includes('\\'), 'Invalid macOS bundle executable name.')
  await writeFile(log, `${name}\n`)
  return join(bundle, 'Contents', 'MacOS', name)
}

export async function smokeInstalled(options) {
  assert.ok(['darwin', 'win32'].includes(process.platform), 'Run this test natively on macOS or Windows.')
  const artifactsDir = resolve(options.artifactsDir || join('dist', 'release-smoke', `${process.platform}-${process.arch}`))
  await mkdir(artifactsDir, { recursive: true })
  const runtimeDir = await mkdtemp(join(tmpdir(), 'viva-release-smoke-'))
  const profile = join(runtimeDir, 'profile')
  await mkdir(profile)
  let mountedDirectory
  let installationDirectory
  let electronApp
  let appProcess
  let page
  const appLogStreams = []
  let closing = false
  const failures = []
  const cleanupFailures = []
  let failure
  let result

  try {
    let target = options.target
    if ((await stat(target)).isDirectory() && !target.toLowerCase().endsWith('.app')) {
      target = await findInstaller(target, process.platform)
    }

    let executable
    let asarPath
    if (process.platform === 'darwin') {
      if (extname(target).toLowerCase() === '.dmg') {
        await command('/usr/bin/hdiutil', ['verify', target], join(artifactsDir, 'dmg-verify.log'))
        mountedDirectory = join(runtimeDir, 'mount')
        await mkdir(mountedDirectory)
        await command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountedDirectory, target], join(artifactsDir, 'dmg-attach.log'))
        const bundle = join(runtimeDir, 'Applications', 'VIVA.app')
        await mkdir(dirname(bundle))
        await command('/usr/bin/ditto', [join(mountedDirectory, 'VIVA.app'), bundle], join(artifactsDir, 'dmg-copy.log'))
        target = bundle
      }
      const bundle = target.toLowerCase().endsWith('.app')
        ? target : resolve(target, '..', '..', '..')
      assert.ok(bundle.toLowerCase().endsWith('.app'), 'Expected VIVA.app or its Contents/MacOS executable.')
      executable = await executableInBundle(bundle, artifactsDir)
      asarPath = join(bundle, 'Contents', 'Resources', 'app.asar')
    } else {
      const siblingArchive = join(dirname(target), 'resources', 'app.asar')
      if (await exists(siblingArchive)) executable = target
      else {
        assert.ok(process.env.GITHUB_ACTIONS === 'true' || options.allowInstaller,
          'NSIS changes the per-user installation registry. Use a disposable GitHub Actions runner, or explicitly pass --allow-installer on a disposable VM.')
        installationDirectory = join(runtimeDir, 'installed')
        await writeFile(join(artifactsDir, 'nsis-install-request.json'), `${JSON.stringify({
          installer: target, destination: installationDirectory, args: ['/S', `/D=${installationDirectory}`]
        }, null, 2)}\n`)
        // PowerShell joins ArgumentList verbatim. NSIS requires /D to be last
        // and unquoted, even when the installation path contains spaces.
        const powershell = win32.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        const install = '$ErrorActionPreference="Stop"; $p=Start-Process -FilePath $env:VIVA_SMOKE_INSTALLER -ArgumentList @("/S",("/D="+$env:VIVA_SMOKE_INSTALL_DIR)) -Wait -PassThru; exit $p.ExitCode'
        await command(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(install, 'utf16le').toString('base64')], join(artifactsDir, 'nsis-install.log'), {
          env: { ...process.env, VIVA_SMOKE_INSTALLER: target, VIVA_SMOKE_INSTALL_DIR: installationDirectory }
        })
        executable = join(installationDirectory, 'VIVA.exe')
      }
      asarPath = join(dirname(executable), 'resources', 'app.asar')
    }

    await access(executable)
    await requireIsolationHook(asarPath)
    const env = { ...process.env, VIVA_USER_DATA_DIR: profile, ELECTRON_ENABLE_LOGGING: 'file', ELECTRON_LOG_FILE: join(artifactsDir, 'electron.log') }
    for (const key of ['VITEST', 'NODE_OPTIONS', 'ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR']) delete env[key]
    if (options.withoutSystemGit) {
      env.PATH = join(runtimeDir, 'empty-path')
      await mkdir(env.PATH)
      // Windows treats environment names case-insensitively; avoid duplicate Path.
      for (const key of Object.keys(env)) if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete env[key]
    }

    const { _electron } = await import('playwright')
    electronApp = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], cwd: runtimeDir, env, timeout: 60_000 })
    appProcess = electronApp.process()
    const stdout = createWriteStream(join(artifactsDir, 'app-stdout.log'))
    const stderr = createWriteStream(join(artifactsDir, 'app-stderr.log'))
    appLogStreams.push(stdout, stderr)
    appProcess.stdout?.pipe(stdout)
    appProcess.stderr?.pipe(stderr)
    electronApp.on('close', () => { if (!closing) failures.push('Application closed unexpectedly.') })
    const attached = new Set()
    const observeWindow = (page) => {
      if (attached.has(page)) return
      attached.add(page)
      page.on('pageerror', (error) => failures.push(`Renderer exception: ${error.message}`))
      page.on('crash', () => failures.push('Renderer process crashed.'))
      page.on('console', (message) => { if (message.type() === 'error') failures.push(`Renderer console error: ${message.text()}`) })
    }
    electronApp.on('window', observeWindow)
    electronApp.windows().forEach(observeWindow)

    const main = await deadline(electronApp.evaluate(({ app }) => ({
      isPackaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'),
      executable: process.execPath, version: app.getVersion(), architecture: process.arch
    })), 30_000, 'Packaged main-process inspection timed out.')
    assert.equal(main.isPackaged, true, 'Smoke must launch the packaged app, not development Electron.')
    assert.equal(await normalizePath(main.appPath), await normalizePath(asarPath), 'The app must load the installed ASAR.')
    assert.equal(await normalizePath(main.userData), await normalizePath(profile), 'The early profile hook must isolate electron-store before imports.')
    assert.equal(await normalizePath(main.executable), await normalizePath(executable), 'The real installed executable must be running.')

    page = await electronApp.firstWindow({ timeout: 30_000 })
    observeWindow(page)
    page.setDefaultTimeout(30_000)
    await page.waitForURL('file://**')
    await page.waitForFunction(() => typeof window.electron?.ipcRenderer?.invoke === 'function')
    const ipc = await deadline(page.evaluate(async () => ({
      preferences: await window.electron.ipcRenderer.invoke('db:preferences:get'),
      projects: await window.electron.ipcRenderer.invoke('db:projects:list'),
      git: await window.electron.ipcRenderer.invoke('git:install:check')
    })), 30_000, 'Packaged preload IPC checks timed out.')
    assert.equal(ipc.preferences.language, 'en', 'Fresh profile must use default preferences.')
    assert.deepEqual(ipc.projects, [], 'Fresh profile must not contain existing projects.')
    assert.equal(ipc.git.installed, options.expectGit !== 'missing', 'Unexpected Git runtime prerequisite state.')
    await page.getByRole('button', { name: 'Lead dashboard', exact: true }).waitFor({ state: 'visible' })
    const clone = page.getByRole('button', { name: 'Clone from GitHub', exact: true }).first()
    await clone.waitFor({ state: 'visible' })
    if (options.expectGit === 'missing') {
      await page.getByRole('heading', { name: 'Install Git to get started', exact: true }).waitFor({ state: 'visible' })
    } else {
      await clone.click()
      const dialog = page.getByRole('dialog', { name: 'Clone a GitHub project', exact: true })
      await dialog.waitFor({ state: 'visible' })
      await dialog.getByLabel('GitHub repository HTTPS URL', { exact: true }).waitFor({ state: 'visible' })
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    }
    const visibleWindows = await deadline(electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((window) => window.isVisible()).length
    ), 10_000, 'Native window visibility check timed out.')
    assert.ok(visibleWindows > 0, 'The installed app must show a native window.')
    await page.screenshot({ path: join(artifactsDir, 'startup.png') })
    assert.deepEqual(failures, [], 'Native packaged startup emitted errors.')
    result = { ok: true, source: options.target, main, rendererUrl: page.url(), ipc, withoutSystemGit: Boolean(options.withoutSystemGit) }
  } catch (error) {
    failure = error
    result = { ok: false, source: options.target, error: error.stack || String(error), failures }
    if (page && !page.isClosed()) {
      try { await page.screenshot({ path: join(artifactsDir, 'failure.png'), timeout: 5_000 }) } catch { /* A crashed renderer cannot produce a screenshot. */ }
    }
  } finally {
    closing = true
    if (electronApp) {
      try { await deadline(electronApp.close(), 10_000, 'Application did not close after smoke test.') }
      catch (error) { cleanupFailures.push(error.message) }
    }
    await killOwnedProcess(appProcess)
    appLogStreams.forEach((stream) => stream.end())
    if (installationDirectory && await exists(join(installationDirectory, 'Uninstall VIVA.exe'))) {
      try { await command(join(installationDirectory, 'Uninstall VIVA.exe'), ['/S'], join(artifactsDir, 'nsis-uninstall.log')) }
      catch (error) { cleanupFailures.push(error.message) }
    }
    if (mountedDirectory) {
      try { await command('/usr/bin/hdiutil', ['detach', mountedDirectory], join(artifactsDir, 'dmg-detach.log')) }
      catch (error) { cleanupFailures.push(error.message) }
    }
    try { await rm(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
    catch (error) { cleanupFailures.push(error.message) }
    await writeFile(join(artifactsDir, 'result.json'), `${JSON.stringify({ ...result, ok: !failure && cleanupFailures.length === 0, cleanupFailures }, null, 2)}\n`)
  }
  if (failure) throw failure
  assert.deepEqual(cleanupFailures, [], 'Smoke cleanup failed; see result.json.')
  console.log(`PASS: ${process.platform}/${process.arch} installed executable, ASAR, isolated profile, renderer, preload IPC, clone/dashboard, Git ${options.expectGit}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) console.log(usage)
    else await smokeInstalled(options)
  } catch (error) {
    console.error(error.stack || String(error))
    process.exitCode = 1
  }
}
