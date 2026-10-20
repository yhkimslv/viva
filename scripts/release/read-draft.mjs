// GitHub's release-by-tag REST endpoint does not resolve draft releases.
// gh release view can find a draft and supplies its numeric REST database ID.
export function readDraftRelease(gh, repository, tag) {
  const release = JSON.parse(gh([
    'release', 'view', tag, '--repo', repository, '--json', 'databaseId,isDraft'
  ]))
  if (release?.isDraft !== true) throw new Error('Release must remain a draft during verification')
  if (!Number.isSafeInteger(release.databaseId) || release.databaseId <= 0) {
    throw new Error('Draft release has an invalid database ID')
  }

  const uploaded = JSON.parse(gh(['api', `repos/${repository}/releases/${release.databaseId}`]))
  if (uploaded?.id !== release.databaseId || uploaded.draft !== true) {
    throw new Error('Release changed while verifying draft assets')
  }
  return uploaded
}
