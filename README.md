# @sandsoftwaresolutions/text-diff

[![CI](https://github.com/SandSoftwareSolutions/ss-text-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-text-diff/actions/workflows/ci.yml)

See exactly what changed between two texts: a list of added, removed and unchanged lines, or a unified diff that `git apply` and `patch` accept. Uses Myers' algorithm, the same one git uses. For tests, config changes, "what did the user edit", reports. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/text-diff
```

## Usage

```js
import { diffLines, unifiedDiff, similarity, stats } from "@sandsoftwaresolutions/text-diff";

diffLines("a\nb\nc", "a\nB\nc");
// [ { type: "equal",  lines: ["a"] },
//   { type: "remove", lines: ["b"] },
//   { type: "add",    lines: ["B"] },
//   { type: "equal",  lines: ["c"] } ]

console.log(unifiedDiff(oldText, newText, { aName: "a/config.json", bName: "b/config.json" }));
// --- a/config.json
// +++ b/config.json
// @@ -2,3 +2,3 @@
//  two
// -three
// +THREE
//  four

stats(oldText, newText);          // { added: 2, removed: 1, unchanged: 40 }
similarity(oldText, newText);     // 0.95  (0 = nothing in common, 1 = identical)
```

## Details

- **Smallest change.** Myers' algorithm finds the fewest added and removed lines; unchanged lines at the start and end are skipped quickly, so comparing two nearly equal files is cheap.
- **Input:** a text, or an array of lines (so you can diff anything line-like, such as the keys of an object). In `diffLines`, `stats` and `similarity`, `\r\n` and a missing final newline do not count as differences.
- **Unified diff:** `context` lines around changes (default 3), hunks merge when they touch, headers use `aName` and `bName`. It returns `""` when nothing differs. The output is tested against `git apply` (random texts, LF and CRLF, with and without a final newline). Because a patch has to apply to the real file, `unifiedDiff` is stricter than `diffLines` about line endings: a text (string) without a final newline gets git's `\ No newline at end of file` marker, and adding or removing only that final newline is a change. With `eol: "auto"` (default) the patch lines end in CRLF when every line of the old text does (or the new text, if the old one has no newline); pass `eol: "\r\n"` or `"\n"` to force it. A file with mixed line endings is not supported. `maxEdits` must be a whole number.
- **`ignoreWhitespace: true`** compares lines without leading, trailing or repeated whitespace.
- **No hang and no memory blow-up on huge input.** Memory depends on the number of *differences*, not on the size of the files: two 10 000-line files with a few hundred or thousand changed lines take about 15 MB extra and well under 100 ms (measured). If two big texts are completely different, `diffLines` throws a `RangeError` after `maxEdits` (default 4000 differences, at most about 64 MB) instead of burning CPU and memory; raise it only if you accept memory growing with its square.
- `patchLines(ops)` rebuilds the new lines from the operations.

This compares lines. For word-level or character-level highlights inside a changed line, run the lines through it again as arrays of words.
