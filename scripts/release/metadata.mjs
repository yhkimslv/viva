import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function releaseMetadata(environment = process.env) {
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid release version')
  const tag = `v${version}`
  if (environment.GITHUB_REF?.startsWith('refs/tags/') && environment.GITHUB_REF !== `refs/tags/${tag}`) {
    throw new Error(`Tag must exactly match package.json version: ${tag}`)
  }
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`)
  return { version, tag, prerelease: version.includes('-') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(releaseMetadata()))
}
