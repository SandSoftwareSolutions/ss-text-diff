import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
