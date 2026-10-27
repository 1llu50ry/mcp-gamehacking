# Codebase-Index Real-Parser Benchmark (TASK-481)

- date: 2026-08-22T17:21:26.880Z
- commit: 0c7d4e832eaad95a2119109107ecfdc1d7502263 (main, dirty)
- node: v24.18.0
- web-tree-sitter: 0.26.11
- tree-sitter: null
- concurrency: 4

| files | phase | changed | parseCount | parsed | mtimeSkipped | symbols | durationMs | cpuU/S(ms) | peakHeap(MB) | files/sec |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | initial | 1000 | 1000 | 1000 | 0 | 3799 | 4459 | 3523/1279 | 22.0 | 224 |
| 1000 | incremental | 10 | 10 | 10 | 990 | 49 | 367 | 215/101 | 19.2 | 27 |
| 10000 | initial | 10000 | 10000 | 10000 | 0 | 37999 | 46990 | 30681/10753 | 49.1 | 213 |
| 10000 | incremental | 100 | 100 | 100 | 9900 | 479 | 875 | 929/288 | 35.5 | 114 |

> parseCount = real `ParserPool.parseFile` invocations (counting proxy).
> Initial phase parses every file (parseCount == fileCount).
> Incremental phase re-parses only changed files; unchanged files skip via the mtime fast-path (mtimeSkipped).
