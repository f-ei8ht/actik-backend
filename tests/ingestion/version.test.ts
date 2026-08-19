import { describe, expect, it } from 'bun:test'
import {
  compareVersions,
  firstIntroducedVersion,
  introducedFromNpmRange,
  parseVersion,
  testOsvAffected,
  versionInRangeEvents,
} from '../../src/ingestion/version'

describe('parseVersion', () => {
  it('splits dotted numeric versions', () => {
    expect(parseVersion('4.17.20')).toEqual([4, 17, 20])
  })

  it('handles prerelease and build metadata', () => {
    expect(parseVersion('1.0.0-alpha.1+build.5')).toEqual([1, 0, 0, 'alpha', 1])
  })

  it('handles pep440 style versions', () => {
    expect(parseVersion('2.26.0')).toEqual([2, 26, 0])
    expect(parseVersion('1.4.post1')).toEqual([1, 4, 'post1'])
  })
})

describe('compareVersions', () => {
  it('compares simple numeric versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
  })

  it('treats shorter numeric versions as older', () => {
    expect(compareVersions('1.2', '1.2.0')).toBeLessThan(0)
  })

  it('orders prereleases before releases', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
  })
})

describe('versionInRangeEvents', () => {
  it('matches introduced/fixed ranges', () => {
    const events = [{ introduced: '4.0.0' }, { fixed: '4.17.21' }]
    expect(versionInRangeEvents(events, '4.17.20')).toBe(true)
    expect(versionInRangeEvents(events, '3.9.0')).toBe(false)
    expect(versionInRangeEvents(events, '4.17.21')).toBe(false)
  })

  it('treats introduced "0" as unbounded', () => {
    const events = [{ introduced: '0' }, { fixed: '1.26.5' }]
    expect(versionInRangeEvents(events, '1.26.4')).toBe(true)
  })

  it('honors last_affected', () => {
    const events = [{ introduced: '9.0.0' }, { last_affected: '9.1.0' }]
    expect(versionInRangeEvents(events, '9.1.0')).toBe(true)
    expect(versionInRangeEvents(events, '9.1.1')).toBe(false)
  })
})

describe('firstIntroducedVersion', () => {
  it('returns the earliest introduced event', () => {
    const affected = {
      ranges: [
        { events: [{ introduced: '4.0.0' }, { fixed: '4.17.21' }] },
        { events: [{ introduced: '3.2.0' }, { fixed: '3.4.0' }] },
      ],
    }
    expect(firstIntroducedVersion(affected)).toBe('3.2.0')
  })

  it('ignores unbounded introduced "0"', () => {
    const affected = { ranges: [{ events: [{ introduced: '0' }, { fixed: '1.26.5' }] }] }
    expect(firstIntroducedVersion(affected)).toBeNull()
  })

  it('returns null when no introduced event exists', () => {
    expect(firstIntroducedVersion({ versions: ['1.0.0'] })).toBeNull()
  })
})

describe('introducedFromNpmRange', () => {
  it('extracts the lower bound from a range', () => {
    expect(introducedFromNpmRange('>= 4.0.0 < 4.17.21')).toBe('4.0.0')
  })

  it('picks the highest lower bound across comparators', () => {
    expect(introducedFromNpmRange('>= 3.0.0 >= 4.0.0 < 5.0.0')).toBe('4.0.0')
  })

  it('handles hyphen ranges', () => {
    expect(introducedFromNpmRange('4.0.0 - 4.17.20')).toBe('4.0.0')
  })

  it('returns null when there is no lower bound', () => {
    expect(introducedFromNpmRange('< 4.17.21')).toBeNull()
    expect(introducedFromNpmRange('')).toBeNull()
    expect(introducedFromNpmRange(undefined)).toBeNull()
  })
})

describe('testOsvAffected', () => {
  it('matches explicit versions lists', () => {
    expect(testOsvAffected({ versions: ['4.17.20', '4.17.19'] }, '4.17.20')).toBe(true)
    expect(testOsvAffected({ versions: ['4.17.20'] }, '4.17.21')).toBe(false)
  })

  it('matches event ranges when no explicit list', () => {
    const affected = {
      ranges: [{ events: [{ introduced: '4.0.0' }, { fixed: '4.17.21' }] }],
    }
    expect(testOsvAffected(affected, '4.17.20')).toBe(true)
    expect(testOsvAffected(affected, '4.17.21')).toBe(false)
  })

  it('returns false for unaffected versions', () => {
    const affected = { ranges: [{ events: [{ introduced: '5.0.0' }] }] }
    expect(testOsvAffected(affected, '4.17.20')).toBe(false)
  })
})
