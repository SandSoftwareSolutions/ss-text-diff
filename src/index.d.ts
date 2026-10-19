export type Lines = string | readonly string[];

export interface DiffOp {
  type: "equal" | "add" | "remove";
  lines: string[];
}

export interface DiffOptions {
  /** Compare lines ignoring leading, trailing and repeated whitespace. */
  ignoreWhitespace?: boolean;
  /** Give up (throw a RangeError) beyond this many differences. Default 4000 (about 64 MB at the limit). */
  maxEdits?: number;
}

export function diffLines(a: Lines, b: Lines, options?: DiffOptions): DiffOp[];
export function unifiedDiff(a: Lines, b: Lines, options?: DiffOptions & { context?: number; aName?: string; bName?: string; /** Line ending of the files the patch is for. Default "auto": CRLF if every line of the old (else new) text ends in CRLF. */ eol?: "auto" | "\n" | "\r\n" }): string;
export function patchLines(ops: readonly DiffOp[]): string[];
export function similarity(a: Lines, b: Lines): number;
export function stats(a: Lines, b: Lines, options?: DiffOptions): { added: number; removed: number; unchanged: number };
