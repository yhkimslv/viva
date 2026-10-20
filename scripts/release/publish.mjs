import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { releaseMetadata } from './metadata.mjs'
import { readDraftRelease } from './read-draft.mjs'

const { version, tag, prerelease } = releaseMetadata()
const repository = process.env.GITHUB_REPOSITORY
if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Missing repository')
if (process.env.GITHUB_REF !== `refs/tags/${tag}`) throw new Error('Publishing requires the matching tag event')
const directory = resolve(process.argv[2] || 'release-assets')
const names = [
  `VIVA-${version}-mac-arm64.dmg`,
  `VIVA-${version}-mac-x64.dmg`,
  `VIVA-${version}-windows-x64-setup.exe`
]
const actual = readdirSync(directory)
if (actual.length !== names.length || names.some(name => !actual.includes(name))) {
  throw new Error('Refusing an incomplete or unexpected set of installers')
}
const notes = resolve(`docs/releases/${tag}.md`)
if (!existsSync(notes)) throw new Error('Versioned installation notes are required')
async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const hashes = new Map()
for (const name of names) {
  const path = resolve(directory, name)
  if (!statSync(path).isFile() || statSync(path).size < 1_000_000) throw new Error(`Invalid installer: ${name}`)
  hashes.set(name, await digest(path))
}
const checksumName = 'SHA256SUMS.txt'
const checksums = names.map(name => `${hashes.get(name)}  ${name}`).join('\n') + '\n'
writeFileSync(resolve(directory, checksumName), checksums)
hashes.set(checksumName, createHash('sha256').update(checksums).digest('hex'))
const assets = [...names, checksumName]
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
let existing
try {
  existing = JSON.parse(gh(['release', 'view', tag, '--repo', repository, '--json', 'isDraft,isPrerelease']))
} catch (error) {
  // Never mistake an authentication or network failure for an absent release.
  if (!String(error.stderr).includes('release not found')) throw error
}
if (existing && !existing.isDraft) throw new Error('A published release is immutable to this workflow; create a new version')
if (!existing) {
  gh(['release', 'create', tag, '--repo', repository, '--verify-tag', '--draft',
    ...(prerelease ? ['--prerelease'] : []), '--title', `VIVA ${version}${prerelease ? ' — Team preview' : ''}`,
    '--notes-file', notes])
} else {
  gh(['release', 'edit', tag, '--repo', repository, '--notes-file', notes])
}
// Replacing an upload is allowed only while the release is still a draft.
gh(['release', 'upload', tag, '--repo', repository, '--clobber', ...assets.map(name => resolve(directory, name))])
const uploaded = readDraftRelease(gh, repository, tag)
if (!uploaded.draft || uploaded.assets.length !== assets.length) throw new Error('Unexpected draft release contents')
for (const name of assets) {
  const asset = uploaded.assets.find(item => item.name === name)
  if (!asset || asset.state !== 'uploaded' || asset.size !== statSync(resolve(directory, name)).size) {
    throw new Error(`Upload verification failed: ${name}`)
  }
  if (asset.digest) {
    if (asset.digest !== `sha256:${hashes.get(name)}`) throw new Error(`GitHub checksum mismatch: ${name}`)
  } else {
    // Older API responses may omit a digest. Verify actual hosted bytes instead.
    const download = mkdtempSync(join(tmpdir(), 'viva-release-verify-'))
    try {
      gh(['release', 'download', tag, '--repo', repository, '--pattern', name, '--dir', download])
      if (await digest(join(download, name)) !== hashes.get(name)) throw new Error(`Downloaded checksum mismatch: ${name}`)
    } finally {
      rmSync(download, { recursive: true, force: true })
    }
  }
}
gh(['release', 'edit', tag, '--repo', repository, '--draft=false',
  `--prerelease=${prerelease}`, `--latest=${!prerelease}`])
console.log(`Published all verified installers: https://github.com/${repository}/releases/tag/${tag}`)
