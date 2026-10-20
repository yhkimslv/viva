import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { findInstaller, parseArguments, prepareUninstaller, requireIsolationHook } from './smoke-installed.mjs'

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'viva-release-script-test-'))
  try { await run(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

test('rejects ambiguous or malformed smoke invocations before launching anything', () => {
  assert.throws(() => parseArguments([]), /Usage:/)
  assert.throws(() => parseArguments(['dist', '--expect-git', 'unknown']), /present or missing/)
  assert.throws(() => parseArguments(['dist', '--artifacts-dir']), /Missing value/)
  assert.throws(() => parseArguments(['dist', 'other']), /exactly one/)
  const options = parseArguments(['dist', '--without-system-git', '--expect-git', 'missing'])
  assert.equal(options.target, resolve('dist'))
  assert.equal(options.withoutSystemGit, true)
  assert.equal(options.expectGit, 'missing')
})

test('chooses the actual Windows installer rather than blockmaps or another architecture', () => fixture(async (directory) => {
  const name = 'VIVA-0.2.1-windows-x64-setup.exe'
  await writeFile(join(directory, name), '')
  await writeFile(join(directory, `${name}.blockmap`), '')
  await writeFile(join(directory, 'VIVA-0.2.1-windows-arm64-setup.exe'), '')
  assert.equal(await findInstaller(directory, 'win32'), join(directory, name))
  await writeFile(join(directory, 'VIVA-0.2.0-windows-x64-setup.exe'), '')
  await assert.rejects(findInstaller(directory, 'win32'), /found 2/)
}))

test('requires exactly one DMG in each native macOS release job', () => fixture(async (directory) => {
  await assert.rejects(findInstaller(directory, 'darwin'), /found 0/)
  const name = 'VIVA-0.2.1-macos-arm64.dmg'
  await writeFile(join(directory, name), '')
  await writeFile(join(directory, `${name}.blockmap`), '')
  assert.equal(await findInstaller(directory, 'darwin'), join(directory, name))
  await writeFile(join(directory, 'VIVA-0.2.1-macos-x64.dmg'), '')
  await assert.rejects(findInstaller(directory, 'darwin'), /found 2/)
}))

test('refuses an older package before it can read a developer profile', () => fixture(async (directory) => {
  const archive = join(directory, 'app.asar')
  await writeFile(archive, 'old application without profile override')
  await assert.rejects(requireIsolationHook(archive), /early VIVA_USER_DATA_DIR hook/)
  await writeFile(archive, 'application main using VIVA_USER_DATA_DIR')
  await requireIsolationHook(archive)
}))

test('runs a copied uninstaller outside the installation with synchronous NSIS arguments', () => fixture(async (directory) => {
  const installation = join(directory, 'install with spaces')
  await mkdir(installation)
  const original = join(installation, 'Uninstall VIVA.exe')
  await writeFile(original, 'disposable uninstaller fixture')

  const plan = await prepareUninstaller(installation, directory)

  assert.equal(dirname(plan.executable), directory)
  assert.notEqual(dirname(plan.executable), installation)
  assert.equal(await readFile(plan.executable, 'utf8'), await readFile(original, 'utf8'))
  assert.deepEqual(plan.args, ['/S', '/currentuser', `_?=${installation}`])
  assert.ok(!plan.args.at(-1).includes('"'), 'NSIS consumes the final _?= path without quotes.')
}))
