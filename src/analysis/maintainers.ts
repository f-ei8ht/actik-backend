export interface SharedMaintainerLink {
  package: string
  maintainer: string
}

export interface MaintainerGroup {
  maintainer: string
  packages: string[]
}

export function groupSharedMaintainers(links: SharedMaintainerLink[]): MaintainerGroup[] {
  const grouped = new Map<string, string[]>()
  for (const link of links) {
    const packages = grouped.get(link.maintainer) ?? []
    if (!packages.includes(link.package)) packages.push(link.package)
    grouped.set(link.maintainer, packages)
  }
  return [...grouped.entries()].map(([maintainer, packages]) => ({ maintainer, packages }))
}
