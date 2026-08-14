import { describe, expect, it } from 'bun:test'
import { groupSharedMaintainers } from '../../src/analysis/maintainers'

describe('groupSharedMaintainers', () => {
  it('groups packages by maintainer', () => {
    const groups = groupSharedMaintainers([
      { package: 'accepts', maintainer: 'wesleytodd' },
      { package: 'body-parser', maintainer: 'wesleytodd' },
      { package: 'lodash', maintainer: 'jdalton' },
    ])
    expect(groups).toEqual([
      { maintainer: 'wesleytodd', packages: ['accepts', 'body-parser'] },
      { maintainer: 'jdalton', packages: ['lodash'] },
    ])
  })

  it('deduplicates packages per maintainer', () => {
    const groups = groupSharedMaintainers([
      { package: 'express', maintainer: 'wesleytodd' },
      { package: 'express', maintainer: 'wesleytodd' },
    ])
    expect(groups).toEqual([{ maintainer: 'wesleytodd', packages: ['express'] }])
  })
})
