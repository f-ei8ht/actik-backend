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

export const lookupPackageIdQuery = `
MATCH (v:PackageVersion)
WHERE v.name = $name AND v.version = $version
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

export const countDirectDependentsQuery = `
MATCH (s {id: $id})<-[:DEPENDS_ON]-(d:PackageVersion)
RETURN count(*) AS count
`
