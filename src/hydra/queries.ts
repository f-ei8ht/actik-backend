const withEcosystem = (alias: string, ecosystem?: string) =>
  ecosystem ? ` AND ${alias}.ecosystem = $ecosystem` : ''

export const seedNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:PackageVersion, v.name = n.name, v.version = n.version, v.ecosystem = n.ecosystem
`

export const seedEdgesQuery = `
UNWIND $edges AS e
MATCH (s:PackageVersion {id: e.source}), (t:PackageVersion {id: e.target})
MERGE (s)-[r:DEPENDS_ON {id: e.id}]->(t)
`

export const lookupPackageIdQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version${withEcosystem('v', ecosystem)}
RETURN v.id AS id
`

export const blastRadiusQuery = (maxDepth = 10) => `
CALL algo.SSpaths({
  sourceNode: $source,
  relTypes: ["DEPENDS_ON"],
  maxLen: ${maxDepth},
  relDirection: "incoming",
  pathCount: 1000
})
YIELD path
RETURN path
`

export const packageByNameQuery = (ecosystem?: string) => `
MATCH (p:Package)
WHERE p.name = $name${withEcosystem('p', ecosystem)}
RETURN p.name AS name, p.ecosystem AS ecosystem
`

export const versionsOfPackageQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)
WHERE v.name = $name${withEcosystem('v', ecosystem)}
RETURN v.version AS version
ORDER BY version
`

export const versionDetailsQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version${withEcosystem('v', ecosystem)}
RETURN v.id AS id, v.name AS name, v.version AS version, v.ecosystem AS ecosystem
`

export const versionCountQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)
WHERE v.name = $name${withEcosystem('v', ecosystem)}
RETURN count(*) AS count
`

export const dependenciesQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version${withEcosystem('v', ecosystem)}
MATCH (v)-[r:DEPENDS_ON]->(t:PackageVersion)
RETURN t.name AS name, t.version AS version, t.ecosystem AS ecosystem
ORDER BY t.name, t.version
`

export const dependentsQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version${withEcosystem('v', ecosystem)}
MATCH (d:PackageVersion)-[r:DEPENDS_ON]->(v)
RETURN d.name AS name, d.version AS version, d.ecosystem AS ecosystem
ORDER BY d.name, d.version
`

export const maintainersOfPackageQuery = (ecosystem?: string) => `
MATCH (p:Package)-[:MAINTAINED_BY]->(m:Maintainer)
WHERE p.name = $name${withEcosystem('p', ecosystem)}
RETURN m.name AS name
ORDER BY m.name
`

export const sharedMaintainersQuery = (ecosystem?: string) => `
MATCH (p:Package)-[:MAINTAINED_BY]->(m:Maintainer)<-[:MAINTAINED_BY]-(q:Package)
WHERE p.name = $name AND q.name <> $name${withEcosystem('p', ecosystem)}
RETURN q.name AS name, m.name AS maintainer
ORDER BY q.name
`

export const advisoryByIdQuery = `
MATCH (a:Advisory)
WHERE a.advisory_id = $id
RETURN a.advisory_id AS id, a.severity AS severity, a.summary AS summary,
  a.published_at AS publishedAt, a.modified_at AS modifiedAt, a.references AS references,
  a.fixed_versions AS fixedVersions
`

export const advisoryAffectedVersionsQuery = `
MATCH (v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
WHERE a.advisory_id = $id
RETURN v.name AS name, v.version AS version, v.ecosystem AS ecosystem
ORDER BY v.name, v.version
`

export const advisoriesForVersionQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
WHERE v.name = $name AND v.version = $version${withEcosystem('v', ecosystem)}
RETURN a.advisory_id AS id, a.severity AS severity, a.summary AS summary,
  a.published_at AS publishedAt, a.modified_at AS modifiedAt, a.fixed_versions AS fixedVersions
ORDER BY a.severity
`

export const advisoryCountForPackageQuery = (ecosystem?: string) => `
MATCH (v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
WHERE v.name = $name${withEcosystem('v', ecosystem)}
RETURN count(*) AS count
`

export const upsertPackageNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Package, v.name = n.name, v.ecosystem = n.ecosystem
`

export const upsertVersionNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:PackageVersion,
  v.name = n.name,
  v.version = n.version,
  v.ecosystem = n.ecosystem,
  v.package_id = n.packageId
`

export const upsertMaintainerNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Maintainer, v.name = n.name, v.ecosystem = n.ecosystem
`

export const upsertAdvisoryNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Advisory,
  v.advisory_id = n.advisoryId,
  v.severity = n.severity,
  v.summary = n.summary,
  v.published_at = n.publishedAt,
  v.modified_at = n.modifiedAt,
  v.references = n.references,
  v.fixed_versions = n.fixedVersions
`

export const upsertOrganizationNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Organization, v.name = n.name
`

export const upsertRepositoryNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Repository,
  v.name = n.name,
  v.org = n.org,
  v.language = n.language,
  v.kind = n.kind
`

export const upsertLockfileNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Lockfile,
  v.path = n.path,
  v.ecosystem = n.ecosystem,
  v.repository = n.repository,
  v.commit_sha = n.commitSha,
  v.kind = n.kind
`

export const resolutionsForVersionQuery = `
MATCH (l:Lockfile)-[r:RESOLVES]->(v:PackageVersion)
WHERE v.id = $id
RETURN l.repository AS repository, l.path AS lockfile, l.commit_sha AS commitSha, l.kind AS kind,
  r.requested_version AS requestedVersion, r.resolved_version AS resolvedVersion
ORDER BY l.repository, l.path
`

export const resolutionsForVersionIdQuery = `
MATCH (l:Lockfile)-[r:RESOLVES]->(v:PackageVersion {id: $id})
RETURN l.repository AS repository, l.path AS lockfile, l.kind AS kind,
  v.id AS versionId, v.name AS name, v.version AS version
ORDER BY l.repository, l.path
`

export const reposByVersionIdQuery = `
MATCH (l:Lockfile)-[:RESOLVES]->(v:PackageVersion)
WHERE v.id = $id
RETURN DISTINCT l.repository AS name, l.kind AS kind
ORDER BY l.repository
`

export const upsertEdgesQuery = (type: string, sourceLabel: string, targetLabel: string) => `
UNWIND $edges AS e
MATCH (s:${sourceLabel} {id: e.source}), (t:${targetLabel} {id: e.target})
MERGE (s)-[r:${type} {id: e.id}]->(t)
`

export const advisoriesForVersionIdQuery = `
MATCH (v:PackageVersion {id: $id})
OPTIONAL MATCH (v)-[:AFFECTED_BY]->(a:Advisory)
RETURN v.id AS versionId, v.name AS name, v.version AS version, v.ecosystem AS ecosystem,
  a.advisory_id AS advisoryId, a.severity AS severity, a.summary AS summary,
  a.published_at AS publishedAt, a.modified_at AS modifiedAt, a.fixed_versions AS fixedVersions
`

export const versionAdvisoryCountQuery = `
MATCH (v:PackageVersion {id: $id})
OPTIONAL MATCH (v)-[:AFFECTED_BY]->(a:Advisory)
RETURN v.id AS id, count(*) AS count
`

export const repoLockfilesQuery = `
MATCH (l:Lockfile)
WHERE l.repository = $repo
RETURN l.id AS id, l.path AS path, l.ecosystem AS ecosystem, l.kind AS kind, l.commit_sha AS commitSha
ORDER BY l.path
`

export const resolutionsForLockfileQuery = `
MATCH (l:Lockfile {id: $id})-[r:RESOLVES]->(v:PackageVersion)
RETURN l.repository AS repository, l.path AS lockfile, v.name AS name, v.version AS version,
  v.ecosystem AS ecosystem, r.requested_version AS requestedVersion,
  r.resolved_version AS resolvedVersion, r.scanned_at AS scannedAt
ORDER BY v.name, v.version
`

export const distinctResolvedVersionsQuery = `
MATCH (l:Lockfile)-[r:RESOLVES]->(v:PackageVersion)
RETURN DISTINCT v.id AS versionId, v.name AS name, v.version AS version, v.ecosystem AS ecosystem
`

export const upsertAlertNodesQuery = `
UNWIND $nodes AS n
MERGE (v {id: n.id})
SET v:Alert,
  v.advisory_id = n.advisoryId,
  v.severity = n.severity,
  v.summary = n.summary,
  v.package = n.package,
  v.version = n.version,
  v.ecosystem = n.ecosystem,
  v.fixed_versions = n.fixedVersions,
  v.first_seen_at = n.firstSeenAt
`

export const existingAlertKeysQuery = `
MATCH (a:Alert)
RETURN a.advisory_id AS advisoryId, a.package AS package, a.version AS version
`

export const recentIncidentsQuery = `
MATCH (a:Alert)
OPTIONAL MATCH (a)-[:EXPOSES]->(l:Lockfile)
RETURN a.advisory_id AS advisoryId, a.severity AS severity, a.summary AS summary,
  a.package AS package, a.version AS version, a.ecosystem AS ecosystem,
  a.fixed_versions AS fixedVersions, a.first_seen_at AS firstSeenAt,
  l.repository AS repository, l.path AS lockfile
ORDER BY a.first_seen_at DESC
`

export const exposureWindowForAdvisoryQuery = `
MATCH (l:Lockfile)-[r:RESOLVES]->(v:PackageVersion)-[:AFFECTED_BY]->(a:Advisory)
WHERE a.advisory_id = $id
RETURN a.advisory_id AS advisoryId, a.severity AS severity, a.summary AS summary,
  l.repository AS repository, l.path AS lockfile, l.kind AS kind,
  v.name AS name, v.version AS version, v.ecosystem AS ecosystem,
  r.requested_version AS requestedVersion, r.scanned_at AS scannedAt,
  a.published_at AS publishedAt, a.modified_at AS modifiedAt
ORDER BY l.repository, l.path
`

export const upsertResolvesEdgesQuery = `
UNWIND $edges AS e
MATCH (s:Lockfile {id: e.source}), (t:PackageVersion {id: e.target})
MERGE (s)-[r:RESOLVES {id: e.id}]->(t)
SET r.requested_version = e.requestedVersion,
    r.resolved_version = e.resolvedVersion,
    r.lockfile_path = e.lockfilePath,
    r.repository = e.repository,
    r.commit_sha = e.commitSha,
    r.scanned_at = e.scannedAt
`
