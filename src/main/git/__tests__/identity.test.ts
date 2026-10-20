import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SimpleGit } from 'simple-git'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitService } from '../service'
import { saveGitIdentity } from '../identity'

const execute = promisify(execFile)
const directories: string[] = []
async function fixture(globalContents = '') {
  const directory = await mkdtemp(join(tmpdir(), 'viva-identity-'))
  directories.push(directory)
  const globalPath = join(directory, 'global-config')
  await writeFile(globalPath, globalContents)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  env.GIT_CONFIG_GLOBAL = globalPath
  env.GIT_CONFIG_NOSYSTEM = '1'
  const git = async (cwd: string, ...args: string[]): Promise<string> => {
    try { return (await execute('git', args, { cwd, env })).stdout }
    catch (error) {
      // git config reports a missing key with exit 1 and no diagnostics.
      const missing = error as { code: number; stdout: string; stderr: string }
      if (missing.code === 1 && !missing.stdout && !missing.stderr) return ''
      throw error
    }
  }
  const first = join(directory, 'first')
  const second = join(directory, 'second')
  await mkdir(first); await mkdir(second)
  await git(first, 'init'); await git(second, 'init')
  // The service's supported Git dependency seam runs real commands while
  // isolating all global configuration and user environment from this test.
  const service = new GitService(first, { raw: (args: string[]) => git(first, ...args) } as unknown as SimpleGit)
  return { directory, globalPath, first, second, git, service }
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('project commit author settings', { timeout: 30_000 }, () => {
  it('allows a fresh Git user to make a first commit without changing global configuration', async () => {
    const f = await fixture()
    expect(await f.service.getIdentity()).toEqual({ name: { value: null, scope: null }, email: { value: null, scope: null } })
    const saved = await f.service.setIdentity({ name: 'Team Member', email: 'member@example.test' })
    expect(saved).toEqual({ name: { value: 'Team Member', scope: 'local' }, email: { value: 'member@example.test', scope: 'local' } })
    await writeFile(join(f.first, 'README.md'), 'First project')
    await f.git(f.first, 'add', '.')
    await f.git(f.first, '-c', 'commit.gpgsign=false', 'commit', '-m', 'First GUI save')
    expect((await f.git(f.first, 'log', '-1', '--format=%an <%ae>')).trim()).toBe('Team Member <member@example.test>')
    expect(await readFile(f.globalPath, 'utf8')).toBe('')
    expect(await f.git(f.second, 'config', '--get', 'user.email')).toBe('')
  })
  it('displays inherited effective values and only overrides the explicitly chosen project', async () => {
    const contents = '[user]\n\tname = Global Person\n\temail = global@example.test\n'
    const f = await fixture(contents)
    expect(await f.service.getIdentity()).toEqual({ name: { value: 'Global Person', scope: 'global' }, email: { value: 'global@example.test', scope: 'global' } })
    const name = '-홍길동 $(not-a-shell-command)'
    await f.service.setIdentity({ name, email: '123+team@users.noreply.github.com' })
    expect((await f.service.getIdentity()).name).toEqual({ value: name, scope: 'local' })
    expect((await f.git(f.second, 'config', '--get', 'user.name')).trim()).toBe('Global Person')
    expect(await readFile(f.globalPath, 'utf8')).toBe(contents)
  })
  it.each([
    { name: '', email: 'valid@example.test' }, { name: 'Line\nBreak', email: 'valid@example.test' },
    { name: 'Someone <else>', email: 'valid@example.test' }, { name: 'x'.repeat(201), email: 'valid@example.test' },
    { name: 'Name\u0085Control', email: 'valid@example.test' }, { name: 'Name\u2028Break', email: 'valid@example.test' },
    { name: 'Valid', email: 'missing-at' }, { name: 'Valid', email: 'two@@example.test' },
    { name: 'Valid', email: 'space here@example.test' }, { name: 'Valid', email: 'a@example.test\0evil' }
  ])('rejects invalid input before writing either configuration key: %j', async (input) => {
    const raw = vi.fn()
    await expect(saveGitIdentity({ raw } as unknown as SimpleGit, input)).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(raw).not.toHaveBeenCalled()
  })
})
