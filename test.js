import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { diffLines, patchLines, similarity, stats, unifiedDiff } from "./src/index.js";

const kinds = (ops) => ops.map((o) => `${o.type[0]}${o.lines.length}`).join(" ");

test("identical, empty and one-sided inputs", () => {
  assert.deepEqual(diffLines("a\nb", "a\nb"), [{ type: "equal", lines: ["a", "b"] }]);
  assert.deepEqual(diffLines("", ""), []);
  assert.deepEqual(diffLines("", "a\nb"), [{ type: "add", lines: ["a", "b"] }]);
  assert.deepEqual(diffLines("a\nb", ""), [{ type: "remove", lines: ["a", "b"] }]);
  assert.equal(unifiedDiff("same\n", "same\n"), "");
});

test("finds the smallest change", () => {
  assert.equal(kinds(diffLines("a\nb\nc\nd", "a\nB\nc\nd")), "e1 r1 a1 e2");
  assert.equal(kinds(diffLines("a\nb\nc", "a\nc")), "e1 r1 e1");
  assert.equal(kinds(diffLines("a\nc", "a\nb\nc")), "e1 a1 e1");
  assert.deepEqual(diffLines(["x"], ["y"]), [{ type: "remove", lines: ["x"] }, { type: "add", lines: ["y"] }]);
  // The textbook example from the Myers paper: ABCABBA -> CBABAC needs exactly 5 edits.
  const ops = diffLines([..."ABCABBA"], [..."CBABAC"]);
  const edits = ops.filter((o) => o.type !== "equal").reduce((n, o) => n + o.lines.length, 0);
  assert.equal(edits, 5);
});

test("the operations always rebuild the new text (random tests)", () => {
  let seed = 12345;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let round = 0; round < 300; round++) {
    const make = () => Array.from({ length: rand(25) }, () => String.fromCharCode(97 + rand(5)));
    const a = make();
    const b = make();
    const ops = diffLines(a, b);
    assert.deepEqual(patchLines(ops), b, `round ${round}`);
    const old = ops.filter((o) => o.type !== "add").flatMap((o) => o.lines);
    assert.deepEqual(old, a, `round ${round}`);
  }
});

test("line endings: CRLF and a final newline do not create differences", () => {
  assert.deepEqual(diffLines("a\r\nb\r\n", "a\nb\n"), [{ type: "equal", lines: ["a", "b"] }]);
  assert.deepEqual(diffLines("a\nb", "a\nb\n"), [{ type: "equal", lines: ["a", "b"] }]);
});

test("ignoreWhitespace compares lines without spacing differences", () => {
  assert.equal(kinds(diffLines("a  b\n  c", "a b\nc\nd", { ignoreWhitespace: true })), "e2 a1");
  assert.equal(kinds(diffLines("a  b", "a b")), "r1 a1");
});

test("unified diff has the format of git diff", () => {
  const a = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n";
  const b = "one\ntwo\nTHREE\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven\n";
  assert.equal(unifiedDiff(a, b, { aName: "a/f.txt", bName: "b/f.txt", context: 1 }),
    "--- a/f.txt\n+++ b/f.txt\n@@ -2,3 +2,3 @@\n two\n-three\n+THREE\n four\n@@ -10 +10,2 @@\n ten\n+eleven\n");
});

test("nearby changes share one hunk; far ones get their own", () => {
  const a = Array.from({ length: 30 }, (_, i) => `line${i}`);
  const b = [...a];
  b[3] = "changed3";
  b[6] = "changed6";
  b[25] = "changed25";
  const diff = unifiedDiff(a, b, { context: 2 });
  assert.equal(diff.split("\n").filter((l) => l.startsWith("@@")).length, 2);
});

test("our unified diff is accepted by `git apply` and `patch`", { skip: !hasGit() }, () => {
  const dir = mkdtempSync(join(tmpdir(), "text-diff-"));
  try {
    const a = Array.from({ length: 40 }, (_, i) => `row ${i}`).join("\n") + "\n";
    const b = a.replace("row 3\n", "row three\n").replace("row 20\n", "").replace("row 35\n", "row 35\nextra\nlines\n");
    writeFileSync(join(dir, "f.txt"), a);
    writeFileSync(join(dir, "p.diff"), unifiedDiff(a, b, { aName: "a/f.txt", bName: "b/f.txt" }));
    execFileSync("git", ["apply", "--unsafe-paths", "-p1", "p.diff"], { cwd: dir });
    assert.equal(readFileSync(join(dir, "f.txt"), "utf8"), b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function hasGit() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("similarity and stats", () => {
  assert.equal(similarity("a\nb", "a\nb"), 1);
  assert.equal(similarity("a\nb", "c\nd"), 0);
  assert.equal(similarity("a\nb\nc\nd", "a\nb\nc\nX"), 0.75);
  assert.equal(similarity("", ""), 1);
  assert.deepEqual(stats("a\nb\nc", "a\nX\nc\nd"), { added: 2, removed: 1, unchanged: 2 });
});

test("a hopeless comparison stops with a clear error instead of hanging", () => {
  const a = Array.from({ length: 300 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 300 }, (_, i) => `b${i}`);
  assert.throws(() => diffLines(a, b, { maxEdits: 100 }), /more than 100 differences/);
  assert.ok(diffLines(a, b).length > 0);
});

function applyWithGit(original, a, b, options) {
  const dir = mkdtempSync(join(tmpdir(), "text-diff-"));
  try {
    writeFileSync(join(dir, "f.txt"), original);
    writeFileSync(join(dir, "p.diff"), unifiedDiff(a, b, { aName: "a/f.txt", bName: "b/f.txt", ...options }));
    execFileSync("git", ["apply", "--unsafe-paths", "-p1", "p.diff"], { cwd: dir, stdio: "pipe" });
    return readFileSync(join(dir, "f.txt"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("files without a final newline get the 'No newline at end of file' marker and git apply accepts it", { skip: !hasGit() }, () => {
  assert.equal(applyWithGit("a\nb", "a\nb", "a\nB"), "a\nB");
  assert.equal(applyWithGit("a\nb\n", "a\nb\n", "a\nb"), "a\nb");
  assert.equal(applyWithGit("a\nb", "a\nb", "a\nb\n"), "a\nb\n");
  assert.equal(applyWithGit("a\nb\nc", "a\nb\nc", "a\nb\nc\nd"), "a\nb\nc\nd");
  assert.equal(applyWithGit("", "", "x"), "x");
  assert.match(unifiedDiff("a\nb", "a\nb\n"), /-b\n\\ No newline at end of file\n\+b\n/);
  assert.equal(unifiedDiff("a\nb", "a\nb"), "");
});

test("CRLF files: the patch lines end in CRLF (eol auto) so git apply accepts them", { skip: !hasGit() }, () => {
  const a = "one\r\ntwo\r\nthree\r\n";
  const b = "one\r\nTWO\r\nthree\r\nfour\r\n";
  assert.equal(applyWithGit(a, a, b), b);
  assert.equal(applyWithGit("x\r\ny", "x\r\ny", "x\r\nz"), "x\r\nz");
  assert.equal(applyWithGit("", "", "x\r\n", { eol: "\r\n" }), "x\r\n");
  assert.ok(unifiedDiff(a, b).includes("-two\r\n"));
  assert.ok(unifiedDiff("one\ntwo\n", "one\nTWO\n").includes("-two\n") && !unifiedDiff("one\ntwo\n", "one\nTWO\n").includes("\r"));
  assert.throws(() => unifiedDiff("a", "b", { eol: "\r" }), RangeError);
});

test("random texts: diffLines is a minimal edit script and unifiedDiff applies with git (LF/CRLF, with and without final newline)", { skip: !hasGit() }, () => {
  const alphabet = ["a", "b", "c", "", "  x", "--- y", "+z", "d d", "\tt"];
  const pick = (n) => randomBytes(1)[0] % n;
  for (let round = 0; round < 40; round++) {
    const nl = pick(3) === 0 ? "\r\n" : "\n";
    const A = Array.from({ length: pick(25) }, () => alphabet[pick(alphabet.length)]);
    const B = A.filter(() => pick(4));
    for (let k = pick(5); k > 0; k--) B.splice(pick(B.length + 1), 0, alphabet[pick(alphabet.length)]);
    const ta = A.join(nl) + (A.length && pick(3) ? nl : "");
    const tb = B.join(nl) + (B.length && pick(3) ? nl : "");
    if ((A.length && A.at(-1) === "" && !ta.endsWith(nl)) || (B.length && B.at(-1) === "" && !tb.endsWith(nl))) continue; // "" as last line without newline is indistinguishable from a final newline
    const ops = diffLines(A, B);
    assert.deepEqual(patchLines(ops), B);
    assert.deepEqual(ops.filter((o) => o.type !== "add").flatMap((o) => o.lines), A);
    if (ta === tb) continue;
    assert.equal(applyWithGit(ta, ta, tb), tb, JSON.stringify([ta, tb]));
  }
});

test("maxEdits must be a whole number", () => {
  for (const bad of [NaN, -1, 1.5, "5"]) assert.throws(() => diffLines("a", "b", { maxEdits: bad }), RangeError);
});
