import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isValidCpf } from './utils'

const srcDir = dirname(fileURLToPath(import.meta.url))

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})

describe('portal public security guards', () => {
  it('validates CPF mathematically', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCpf('123.456.789-00')).toBe(false)
  })

  it('does not keep known corrupted Portuguese strings or literal unicode escapes in source files', () => {
    const unicodeEscapePrefix = `${String.fromCharCode(92)}u00`
    const broken = (...codes: number[]) => String.fromCharCode(...codes)
    const forbidden = [
      broken(111, 112, 195, 167, 195, 163, 111),
      broken(99, 195, 179, 100, 105, 103, 111),
      broken(97, 100, 109, 105, 110, 105, 115, 116, 114, 97, 195, 167, 195, 163, 111),
      broken(110, 195, 186, 109, 101, 114, 111, 115),
      broken(109, 195, 161, 115, 99, 97, 114, 97),
      broken(115, 101, 114, 195, 161, 32, 97, 112, 108, 105, 99, 97, 100, 97),
      '\\uFFFD',
      unicodeEscapePrefix,
    ]
    const files = walk(srcDir).filter((file) => /\.(ts|tsx|css)$/.test(file) && !file.endsWith('portal-security.test.ts'))
    const matches = files.flatMap((file) => {
      const content = readFileSync(file, 'utf8')
      return forbidden.filter((pattern) => content.includes(pattern)).map((pattern) => `${file}: ${pattern}`)
    })
    expect(matches).toEqual([])
  })
})
