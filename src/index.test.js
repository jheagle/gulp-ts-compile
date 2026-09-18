import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import File from 'vinyl'
import { jest } from '@jest/globals'
import { tsCompile } from './index.js'

/**
 * Collect every vinyl file pushed to a stream into an array, resolving once it ends.
 * @param {import('node:stream').Readable} stream
 * @returns {Promise<Array<import('vinyl')>>}
 */
const collect = (stream) => new Promise((resolve, reject) => {
  const files = []
  stream.on('data', (file) => files.push(file))
  stream.on('end', () => resolve(files))
  stream.on('error', reject)
})

/**
 * Wrap a real file on disk (TypeScript's compiler host reads from disk, like gulp's own src() does) as a vinyl
 * file, matching what a real gulp pipeline would hand the plugin.
 * @param {string} base
 * @param {string} relativePath
 * @returns {import('vinyl')}
 */
const vinylFor = (base, relativePath) => new File({
  cwd: base,
  base,
  path: path.join(base, relativePath)
})

describe('tsCompile', () => {
  let tempDir

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'gulp-ts-compile-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('compiles a single file to js and a matching d.ts, preserving directory structure', async () => {
    mkdirSync(path.join(tempDir, 'functions'), { recursive: true })
    writeFileSync(
      path.join(tempDir, 'functions', 'greet.ts'),
      'export const greet = (name: string): string => `hello ${name}`\n'
    )

    const compile = tsCompile({
      declaration: true,
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    })
    const jsFiles = collect(compile.js)
    const dtsFiles = collect(compile.dts)
    compile.end(vinylFor(tempDir, 'functions/greet.ts'))

    const [js, dts] = await Promise.all([jsFiles, dtsFiles])

    expect(js).toHaveLength(1)
    expect(js[0].base).toBe(tempDir)
    expect(path.relative(tempDir, js[0].path)).toBe(path.join('functions', 'greet.js'))
    expect(js[0].contents.toString()).toContain('const greet')

    expect(dts).toHaveLength(1)
    expect(path.relative(tempDir, dts[0].path)).toBe(path.join('functions', 'greet.d.ts'))
    expect(dts[0].contents.toString()).toContain('declare const greet')
  })

  test('compiles multiple files as one program, resolving imports between them', async () => {
    writeFileSync(
      path.join(tempDir, 'helper.ts'),
      'export const double = (value: number): number => value * 2\n'
    )
    writeFileSync(
      path.join(tempDir, 'main.ts'),
      'import { double } from \'./helper\'\nexport const quadruple = (value: number): number => double(double(value))\n'
    )

    const compile = tsCompile({
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    })
    const jsFiles = collect(compile.js)
    compile.write(vinylFor(tempDir, 'helper.ts'))
    compile.end(vinylFor(tempDir, 'main.ts'))

    const js = await jsFiles
    expect(js).toHaveLength(2)
    const main = js.find((file) => file.path.endsWith('main.js'))
    expect(main.contents.toString()).toContain('quadruple')
  })

  test('still emits output when there is a type error, matching tsc\'s tolerant emit behaviour', async () => {
    writeFileSync(
      path.join(tempDir, 'broken.ts'),
      'export const total: number = \'not a number\'\n'
    )
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const compile = tsCompile({
      target: ts.ScriptTarget.ES2015,
      module: ts.ModuleKind.ES2020,
      moduleResolution: ts.ModuleResolutionKind.Bundler
    })
    const jsFiles = collect(compile.js)
    compile.end(vinylFor(tempDir, 'broken.ts'))

    const js = await jsFiles
    expect(js).toHaveLength(1)
    expect(js[0].contents.toString()).toContain('not a number')
    expect(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')).toMatch(/emit succeeded \(with \d+ errors?\)/)

    logSpy.mockRestore()
  })

  test('ends both output streams with no input files', async () => {
    const compile = tsCompile({})
    const jsFiles = collect(compile.js)
    const dtsFiles = collect(compile.dts)
    compile.end()

    expect(await jsFiles).toHaveLength(0)
    expect(await dtsFiles).toHaveLength(0)
  })
})
