import { describe, expect, it } from 'bun:test'
import { testNpmRange } from '../../src/ingestion/version'

describe('testNpmRange', () => {
  it('matches exact and wildcard ranges', () => {
    expect(testNpmRange('4.17.20', '4.17.20')).toBe(true)
    expect(testNpmRange('4.17.20', '4.17.21')).toBe(false)
    expect(testNpmRange('*', '1.2.3')).toBe(true)
    expect(testNpmRange('4.x', '4.17.21')).toBe(true)
    expect(testNpmRange('4.x', '5.0.0')).toBe(false)
    expect(testNpmRange('1.2.x', '1.2.9')).toBe(true)
  })

  it('matches comparison operators', () => {
    expect(testNpmRange('>=4.0.0', '4.17.20')).toBe(true)
    expect(testNpmRange('>=4.0.0', '3.9.0')).toBe(false)
    expect(testNpmRange('<4.17.21', '4.17.20')).toBe(true)
    expect(testNpmRange('<4.17.21', '4.17.21')).toBe(false)
    expect(testNpmRange('<=1.0.0', '1.0.0')).toBe(true)
  })

  it('matches space-separated AND ranges', () => {
    expect(testNpmRange('>=4.0.0 <4.17.21', '4.17.20')).toBe(true)
    expect(testNpmRange('>=4.0.0 <4.17.21', '4.17.21')).toBe(false)
    expect(testNpmRange('>=4.0.0 <4.17.21', '3.9.0')).toBe(false)
  })

  it('matches caret ranges', () => {
    expect(testNpmRange('^4.0.0', '4.17.20')).toBe(true)
    expect(testNpmRange('^4.0.0', '5.0.0')).toBe(false)
    expect(testNpmRange('^0.2.3', '0.2.9')).toBe(true)
    expect(testNpmRange('^0.2.3', '0.3.0')).toBe(false)
    expect(testNpmRange('^0.0.3', '0.0.4')).toBe(false)
  })

  it('matches tilde ranges', () => {
    expect(testNpmRange('~1.2.3', '1.2.9')).toBe(true)
    expect(testNpmRange('~1.2.3', '1.3.0')).toBe(false)
    expect(testNpmRange('~1.2', '1.2.5')).toBe(true)
    expect(testNpmRange('~1.2', '1.3.0')).toBe(false)
  })

  it('matches OR groups', () => {
    expect(testNpmRange('1.x || 2.x', '2.5.0')).toBe(true)
    expect(testNpmRange('1.x || 2.x', '3.0.0')).toBe(false)
  })

  it('matches hyphen ranges', () => {
    expect(testNpmRange('1.2.3 - 2.3.4', '1.9.0')).toBe(true)
    expect(testNpmRange('1.2.3 - 2.3.4', '2.5.0')).toBe(false)
  })

  it('handles prereleases conservatively', () => {
    expect(testNpmRange('>=1.0.0', '1.0.0-alpha')).toBe(false)
    expect(testNpmRange('>=1.0.0', '1.0.0')).toBe(true)
  })

  it('treats empty ranges as any', () => {
    expect(testNpmRange('', '1.0.0')).toBe(true)
    expect(testNpmRange(undefined, '1.0.0')).toBe(true)
  })
})
