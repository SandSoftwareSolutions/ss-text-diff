const toLines = (text) => {
  if (Array.isArray(text)) return text.map(String);
  const normalized = String(text).replace(/\r\n/g, "\n");
  if (normalized === "") return [];
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/**
 * Myers' difference algorithm: the smallest set of added and removed lines that turns `a` into `b`.
 * Returns operations in order: `{ type: "equal" | "add" | "remove", lines: [...] }`, consecutive lines of the same kind grouped.
 * `a` and `b` are texts or arrays of lines. Option `ignoreWhitespace` compares lines without surrounding/repeated whitespace.
 * `maxEdits` (default 4000) stops runaway work on huge, completely different inputs by throwing a RangeError. Memory grows with the square of the number of differences (about 4 bytes x d x d, so 64 MB at the default limit), not with the size of the files.
 */
export function diffLines(a, b, { ignoreWhitespace = false, maxEdits = 4000 } = {}) {
  if (!(Number.isInteger(maxEdits) && maxEdits >= 0) && maxEdits !== Infinity) throw new RangeError("text-diff: maxEdits must be a whole number of at least 0");
  const x = toLines(a);
  const y = toLines(b);
  const squeeze = (line) => line.trim().replace(/\s+/g, " ");
  // (a line marked NO_EOL by unifiedDiff keeps its mark, so "b" and "b " still match under ignoreWhitespace)
  const key = ignoreWhitespace ? (line) => (line.endsWith(NO_EOL) ? squeeze(line.slice(0, -NO_EOL.length)) + NO_EOL : squeeze(line)) : (line) => line;
  const kx = x.map(key);
  const ky = y.map(key);
  let start = 0;
  while (start < kx.length && start < ky.length && kx[start] === ky[start]) start++;
  let endX = kx.length;
  let endY = ky.length;
  while (endX > start && endY > start && kx[endX - 1] === ky[endY - 1]) {
    endX--;
    endY--;
  }
  const middle = myers(kx.slice(start, endX), ky.slice(start, endY), maxEdits);
  const ops = [];
  const push = (type, line) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.lines.push(line);
    else ops.push({ type, lines: [line] });
  };
  for (let i = 0; i < start; i++) push("equal", x[i]);
  let i = start;
  let j = start;
  for (const step of middle) {
    if (step === "=") {
      push("equal", x[i]);
      i++;
      j++;
    } else if (step === "-") {
      push("remove", x[i]);
      i++;
    } else {
      push("add", y[j]);
      j++;
    }
  }
  for (let k = endX; k < x.length; k++) push("equal", x[k]);
  return ops;
}

function myers(a, b, maxEdits) {
  const n = a.length;
  const m = b.length;
  if (n === 0) return Array(m).fill("+");
  if (m === 0) return Array(n).fill("-");
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const trace = []; // per round only the diagonals that can matter (-d..d), so memory grows with d squared, not with the input size
  let v = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
  }
  throw new RangeError(`text-diff: more than ${max} differences; raise maxEdits if you really want to compare these`);
}

function backtrack(trace, a, b, depth) {
  const steps = [];
  let x = a.length;
  let y = b.length;
  for (let d = depth; d > 0; d--) {
    const v = trace[d]; // v[k + d] holds the value of diagonal k
    const k = x - y;
    const down = k === -d || (k !== d && v[d + k - 1] < v[d + k + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[d + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push("=");
      x--;
      y--;
    }
    steps.push(down ? "+" : "-");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps.push("=");
    x--;
    y--;
  }
  return steps.reverse();
}

// Whether a text argument has no newline at its end ("a\nb"): the unified format marks that with "\ No newline at end of file".
const NO_EOL = "\u0000no-eol\u0000";
const lacksFinalNewline = (text) => typeof text === "string" && text !== "" && !text.endsWith("\n");
// "auto": CRLF when every line of the old text (or, if that has no newline, the new text) ends in CRLF, else LF.
const detectEol = (text) => (typeof text !== "string" || !text.includes("\n") ? null : /(?<!\r)\n/.test(text) ? "\n" : "\r\n");

/**
 * A diff in the unified format that `git diff` and `patch` use. Returns an empty string when nothing differs.
 * Options: `context` (unchanged lines around each change, default 3), `aName` and `bName` for the `---` and `+++` lines, and `eol`
 * ("auto" (default), "\n" or "\r\n"): the line ending of the files the patch is for. "auto" uses CRLF when the old text (or, if that has
 * no newline, the new text), given as a string, has CRLF on every line. A text (string) that does not end in a newline gets `\ No newline at end of file`, and a difference
 * in only that final newline is a change in the diff.
 */
export function unifiedDiff(a, b, { context = 3, aName = "a", bName = "b", eol = "auto", ...options } = {}) {
  if (!["auto", "\n", "\r\n"].includes(eol)) throw new RangeError('text-diff: eol must be "auto", "\\n" or "\\r\\n"');
  const lineEnd = eol === "auto" ? (detectEol(a) ?? detectEol(b) ?? "\n") : eol;
  const cr = lineEnd === "\r\n" ? "\r" : "";
  const noEolA = lacksFinalNewline(a);
  const noEolB = lacksFinalNewline(b);
  // A last line without a newline is a different line from the same text with one (as in git): mark it while comparing.
  const mark = (text, noEol) => {
    const lines = toLines(text);
    if (noEol && lines.length) lines[lines.length - 1] += NO_EOL;
    return lines;
  };
  const ops = diffLines(mark(a, noEolA), mark(b, noEolB), options);
  if (ops.every((op) => op.type === "equal")) return "";
  const rows = ops.flatMap((op) =>
    op.lines.map((line) => (line.endsWith(NO_EOL) ? { type: op.type, line: line.slice(0, -NO_EOL.length), noEol: true } : { type: op.type, line }))
  );
  let aLine = 1;
  let bLine = 1;
  for (const row of rows) {
    row.a = aLine;
    row.b = bLine;
    if (row.type !== "add") aLine++;
    if (row.type !== "remove") bLine++;
  }
  const hunks = [];
  let current = null;
  rows.forEach((row, index) => {
    if (row.type === "equal") return;
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length, index + context + 1);
    if (current && from <= current.to) current.to = to;
    else hunks.push((current = { from, to }));
  });
  const out = [`--- ${aName}`, `+++ ${bName}`];
  for (const { from, to } of hunks) {
    const slice = rows.slice(from, to);
    const aCount = slice.filter((r) => r.type !== "add").length;
    const bCount = slice.filter((r) => r.type !== "remove").length;
    const aStart = aCount === 0 ? (slice[0].a - 1) : slice.find((r) => r.type !== "add").a;
    const bStart = bCount === 0 ? (slice[0].b - 1) : slice.find((r) => r.type !== "remove").b;
    out.push(`@@ -${aStart}${aCount === 1 ? "" : `,${aCount}`} +${bStart}${bCount === 1 ? "" : `,${bCount}`} @@`);
    for (const r of slice) {
      out.push(`${r.type === "add" ? "+" : r.type === "remove" ? "-" : " "}${r.line}${r.noEol ? "" : cr}`);
      if (r.noEol) out.push("\\ No newline at end of file");
    }
  }
  return `${out.join("\n")}\n`;
}

/** The lines of the new text, rebuilt from the operations of `diffLines` (everything except the removed lines). */
export function patchLines(ops) {
  return ops.filter((op) => op.type !== "remove").flatMap((op) => op.lines);
}

/** How alike two texts are, from 0 (nothing in common) to 1 (identical lines), based on the lines they share. */
export function similarity(a, b) {
  const ops = diffLines(a, b);
  const same = ops.filter((o) => o.type === "equal").reduce((sum, o) => sum + o.lines.length, 0);
  const total = Math.max(toLines(a).length, toLines(b).length);
  return total === 0 ? 1 : same / total;
}

/** Counts what changed: `{ added, removed, unchanged }` lines. */
export function stats(a, b, options) {
  const count = (type) => diffLines(a, b, options).filter((o) => o.type === type).reduce((sum, o) => sum + o.lines.length, 0);
  return { added: count("add"), removed: count("remove"), unchanged: count("equal") };
}
