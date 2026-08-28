# Next.js shared FileSystemCache write race reproduction

This repository demonstrates why writing a cache entry directly to its final
path can expose invalid JSON when multiple writers share a cache directory.

## Run

```bash
pnpm install
pnpm repro
```

Expected output on an affected implementation:

```text
{ parseErrors: <a positive number>, finalWriter: 'A' | 'B' | 'invalid JSON' }
```

The script uses Next.js' `MultiFileWriter` with a filesystem adapter that
models a shared/network filesystem. Two writers update the same cache entry
while a reader continuously parses it. Because `MultiFileWriter.append()`
writes directly to the final path, readers can observe an empty, partial, or
interleaved JSON document.

Next.js already includes `writeFileAtomic()`, which writes to a temporary file
in the same directory and then renames it over the destination. Using that
strategy for FileSystemCache entries prevents readers from observing an
in-progress write; concurrent writers still have last-writer-wins semantics,
but every visible value is complete.

The production case that motivated this reproduction used multiple Next.js
standalone instances with `.next/cache` on the same RWX network filesystem.

## Versions verified

- `next@15.5.15`: reproduced with 1,835 parse failures in one run.
- `next@16.4.0-canary.9`: reproduced with 1,613 parse failures in one run.

To verify the stable release:

```bash
pnpm add next@15.5.15
pnpm repro
```
