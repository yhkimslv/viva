import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readDraftRelease } from './read-draft.mjs'

const repository = 'yhkimslv/viva'
const tag = 'v0.3.0-beta.1'
const databaseId = 417875455

test('reads a draft through its database ID even when the tag API cannot resolve it', () => {
  const assets = [{ name: 'verified-installer.dmg', state: 'uploaded' }]
  const gh = (args) => {
    if (args[0] === 'release') {
      assert.deepEqual(args, ['release', 'view', tag, '--repo', repository, '--json', 'databaseId,isDraft'])
      return JSON.stringify({ databaseId, isDraft: true })
    }
    if (args[1] === `repos/${repository}/releases/tags/${tag}`) throw new Error('HTTP 404: Not Found')
    assert.deepEqual(args, ['api', `repos/${repository}/releases/${databaseId}`])
    return JSON.stringify({ id: databaseId, draft: true, assets })
  }

  assert.deepEqual(readDraftRelease(gh, repository, tag), { id: databaseId, draft: true, assets })
})

test('rejects a published or unknown release state before requesting its assets', () => {
  for (const isDraft of [false, undefined, null, 'true']) {
    let calls = 0
    const gh = () => {
      calls += 1
      return JSON.stringify({ databaseId, isDraft })
    }
    assert.throws(() => readDraftRelease(gh, repository, tag), /must remain a draft/)
    assert.equal(calls, 1)
  }
})

test('rejects missing, nonnumeric, nonpositive and unsafe database IDs before requesting assets', () => {
  for (const invalidId of [undefined, null, '417875455', 0, -1, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    let calls = 0
    const gh = () => {
      calls += 1
      return JSON.stringify({ databaseId: invalidId, isDraft: true })
    }
    assert.throws(() => readDraftRelease(gh, repository, tag), /invalid database ID/)
    assert.equal(calls, 1)
  }
})

test('refuses assets if the ID response belongs to another release or is no longer a draft', () => {
  for (const release of [
    { id: databaseId + 1, draft: true },
    { id: databaseId, draft: false }
  ]) {
    const gh = (args) => JSON.stringify(args[0] === 'release'
      ? { databaseId, isDraft: true }
      : release)
    assert.throws(() => readDraftRelease(gh, repository, tag), /changed while verifying/)
  }
})
