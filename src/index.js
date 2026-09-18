import { Transform, PassThrough } from 'node:stream'
import path from 'node:path'
import ts from 'typescript'
import File from 'vinyl'

const DECLARATION_RE = /\.d\.(ts|mts|cts)$/
const JS_RE = /\.(js|mjs|cjs)$/

/**
 * Format and print TypeScript diagnostics the same way the `tsc` CLI does, using only the stable, public
 * `ts.formatDiagnosticsWithColorAndContext` API - never `convertCompilerOptionsFromJson` or
 * `parseJsonConfigFileContent`, which is exactly the kind of internal/legacy surface that broke gulp-typescript
 * when a removed API call started throwing under TypeScript 7.
 * @param {ReadonlyArray<import('typescript').Diagnostic>} diagnostics
 * @returns {undefined}
 */
const printDiagnostics = (diagnostics) => {
  if (!diagnostics.length) {
    return
  }
  const formatHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine
  }
  console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost))
}

/**
 * Find the vinyl input file an emitted output belongs to. TypeScript's own `writeFile` callback normally reports
 * the originating source file(s) directly - preferred, since it needs no assumptions about path layout - but
 * falls back to matching by replacing the emitted file's extension with `.ts`/`.tsx`, in case a given TypeScript
 * version or emit kind ever leaves `sourceFiles` empty.
 * @param {string} fileName - The absolute path TypeScript wrote (or would have written) the emitted file to.
 * @param {ReadonlyArray<import('typescript').SourceFile>|undefined} sourceFiles
 * @param {Map<string, import('vinyl')>} inputsByPath - Resolved input path -> originating vinyl file.
 * @param {Array<import('vinyl')>} inputFiles
 * @returns {import('vinyl')|undefined}
 */
const findInputFile = (fileName, sourceFiles, inputsByPath, inputFiles) => {
  const sourceFileName = sourceFiles && sourceFiles[0] && sourceFiles[0].fileName
  if (sourceFileName) {
    const matched = inputsByPath.get(path.resolve(sourceFileName))
    if (matched) {
      return matched
    }
  }
  const withoutEmitExtension = fileName
    .replace(/\.d\.(ts|mts|cts)$/, '')
    .replace(/\.(js|mjs|cjs)$/, '')
  return inputFiles.find(
    (file) => file.path.replace(/\.tsx?$/, '') === withoutEmitExtension
  )
}

/**
 * A minimal gulp-typescript replacement: pipe a stream of `.ts`/`.tsx` vinyl files in, get a transform back whose
 * `.js` and `.dts` properties are separate vinyl streams of the compiled output - the same calling shape
 * gulp-typescript used, so existing pipelines only need an import swap.
 *
 * Unlike gulp-typescript, `options` are real `typescript.CompilerOptions` values (e.g.
 * `target: ts.ScriptTarget.ES2015`) rather than JSON-style strings (`target: 'es6'`) - this package does zero
 * version-sensitive string-to-enum translation itself, since that responsibility belongs to the calling project,
 * which already depends on `typescript` directly at whatever version it actually uses.
 * @param {import('typescript').CompilerOptions} [options={}]
 * @returns {import('node:stream').Transform & {js: import('node:stream').PassThrough, dts: import('node:stream').PassThrough}}
 */
export const tsCompile = (options = {}) => {
  const inputFiles = []
  const jsStream = new PassThrough({ objectMode: true })
  const dtsStream = new PassThrough({ objectMode: true })

  const transform = new Transform({
    objectMode: true,
    transform (file, enc, callback) {
      // Compilation reads source text from disk via file.path (through the TypeScript compiler host), not from
      // file.contents, so a null-content vinyl file (e.g. gulp's src({read: false}) optimization) is still valid
      // input here - unlike most gulp plugins, there's no reason to require buffered contents at all.
      if (file.isDirectory()) {
        callback()
        return
      }
      inputFiles.push(file)
      callback()
    },
    flush (callback) {
      if (inputFiles.length === 0) {
        jsStream.end()
        dtsStream.end()
        callback()
        return
      }

      const inputsByPath = new Map(
        inputFiles.map((file) => [path.resolve(file.path), file])
      )
      const compilerOptions = { ...options }
      const host = ts.createCompilerHost(compilerOptions)
      host.writeFile = (fileName, data, writeByteOrderMark, onError, sourceFiles) => {
        const inputFile = findInputFile(fileName, sourceFiles, inputsByPath, inputFiles)
        if (!inputFile) {
          return
        }
        const outFile = new File({
          cwd: inputFile.cwd,
          base: inputFile.base,
          path: path.join(path.dirname(inputFile.path), path.basename(fileName)),
          contents: Buffer.from(data)
        })
        if (DECLARATION_RE.test(fileName)) {
          dtsStream.push(outFile)
          return
        }
        if (JS_RE.test(fileName)) {
          jsStream.push(outFile)
        }
      }

      const fileNames = inputFiles.map((file) => file.path)
      const program = ts.createProgram(fileNames, compilerOptions, host)
      const preEmitDiagnostics = ts.getPreEmitDiagnostics(program)
      printDiagnostics(preEmitDiagnostics)
      const emitResult = program.emit()
      printDiagnostics(emitResult.diagnostics)

      const errorCount = preEmitDiagnostics.length + emitResult.diagnostics.length
      console.log(
        `TypeScript: emit ${emitResult.emitSkipped ? 'failed' : 'succeeded'}` +
        (errorCount ? ` (with ${errorCount} error${errorCount === 1 ? '' : 's'})` : '')
      )

      jsStream.end()
      dtsStream.end()
      callback()
    }
  })

  transform.js = jsStream
  transform.dts = dtsStream
  return transform
}

export default tsCompile
