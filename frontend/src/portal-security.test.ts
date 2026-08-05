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

  it('does not keep known corrupted Portuguese strings in source files', () => {
    const forbidden = ['op??o', 'c?digo', 'administra??o', 'n?meros', 'm?scara', 'ser? aplicada', '\uFFFD']
    const files = walk(srcDir).filter((file) => /\.(ts|tsx|css)$/.test(file) && !file.endsWith('portal-security.test.ts'))
    const matches = files.flatMap((file) => {
      const content = readFileSync(file, 'utf8')
      return forbidden.filter((pattern) => content.includes(pattern)).map((pattern) => `${file}: ${pattern}`)
    })
    expect(matches).toEqual([])
  })
})
