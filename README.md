# gulp-ts-compile

A minimal [gulp](https://gulpjs.com/) TypeScript plugin, built directly on the `typescript` package's stable,
public Compiler API - no version-sensitive internal APIs, no JSON-style option strings to translate.

## Why

[`gulp-typescript`](https://www.npmjs.com/package/gulp-typescript) has been stuck on an alpha release for years
and calls `typescript.convertCompilerOptionsFromJson`, an internal API that TypeScript removed - so any project
still using it breaks the moment `typescript` is upgraded past whatever version that function last existed in.
`gulp-ts-compile` uses only `ts.createProgram`, `ts.createCompilerHost`, `program.emit()`, and
`ts.getPreEmitDiagnostics` - all long-standing, documented, public Compiler API functions - and does zero
option translation of its own, so there's nothing here to break the same way again.

**Note:** TypeScript 7's Go-based rewrite ("tsgo") removed the classic JS Compiler API entirely - `typescript@7.x`'s
package no longer exports `createProgram`, `ScriptTarget`, or any of the rest of it, replacing it with a
different, explicitly `unstable` API surface. No tool built on the classic API - this one included - can support
`typescript@7.x` yet. This package's `peerDependencies` range (`>=5.0.0 <7.0.0`) reflects that.

## Install

```
npm install --save-dev gulp-ts-compile typescript
```

## Usage

```js
import { dest, src } from 'gulp'
import ts from 'typescript'
import { tsCompile } from 'gulp-ts-compile'

export const typescript = () => {
  const result = src('src/**/*.ts').pipe(tsCompile({
    declaration: true,
    target: ts.ScriptTarget.ES2015,
    module: ts.ModuleKind.ES2020,
    moduleResolution: ts.ModuleResolutionKind.Node10
  }))
  result.dts.pipe(dest('dist'))
  return result.js.pipe(dest('dist'))
}
```

`tsCompile(options)` returns a transform stream you pipe `.ts`/`.tsx` vinyl files into (matching how
`gulp-typescript`'s `ts(options)` worked), which exposes two further vinyl streams once compilation finishes:

- `.js` - the compiled JavaScript output
- `.dts` - the emitted `.d.ts` declaration files (only populated if `declaration: true` is set)

Both streams preserve each input file's original directory structure relative to its `base`, so piping either
into `dest('dist')` mirrors `src/`'s layout under `dist/`.

### Options

`options` is passed straight through as real [`typescript.CompilerOptions`](https://www.typescriptlang.org/tsconfig)
values - e.g. `target: ts.ScriptTarget.ES2015`, not `target: 'es6'`. This is deliberate: the calling project
already depends on `typescript` directly, so it can always resolve the right enum values for whatever version
it's actually using, and `gulp-ts-compile` never has to guess or translate.

### Error handling

Like `tsc` itself, compilation still emits output even when there are type errors - diagnostics are printed to
the console (in the same format `tsc` uses) and a summary line reports the error count, but the task doesn't
fail outright. If you want strict, error-blocking behavior, check the compiled output yourself downstream.
