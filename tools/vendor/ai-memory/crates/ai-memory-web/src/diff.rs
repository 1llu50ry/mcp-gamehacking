//! Bounded line diff for the page-history view.
//!
//! Myers' O((N+M)·D) algorithm over lines, after trimming the common prefix
//! and suffix. Every dimension is capped: input bytes and lines per side, the
//! edit distance the search may explore, and the rendered output lines. A
//! pair past a cap renders as [`Diff::TooLarge`] instead of spending memory
//! or CPU on a page nobody can read as a diff anyway.

use serde::Serialize;

/// Largest side, in bytes, the diff accepts.
pub(crate) const MAX_INPUT_BYTES: usize = 512 * 1024;
/// Largest side, in lines, the diff accepts.
pub(crate) const MAX_INPUT_LINES: usize = 10_000;
/// Most line edits the search explores before giving up. Its trace keeps one
/// frontier per edit step, so memory grows with the square of this.
pub(crate) const MAX_EDIT_DISTANCE: usize = 1_000;
/// Most diff lines (context and changes) one response carries.
pub(crate) const MAX_OUTPUT_LINES: usize = 2_000;
/// Unchanged lines shown around each change.
const CONTEXT: usize = 3;

/// One rendered diff line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct DiffLine {
    /// `' '` context, `'-'` removed, `'+'` added.
    pub op: char,
    /// The line, without its newline.
    pub text: String,
}

/// One hunk: a run of changes with surrounding context.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Hunk {
    /// 1-based first line in the old text (0 when the hunk is empty there).
    pub old_start: usize,
    /// Lines the hunk covers in the old text.
    pub old_len: usize,
    /// 1-based first line in the new text (0 when the hunk is empty there).
    pub new_start: usize,
    /// Lines the hunk covers in the new text.
    pub new_len: usize,
    /// The hunk's lines.
    pub lines: Vec<DiffLine>,
}

impl Hunk {
    /// The `@@ -a,b +c,d @@` header line.
    pub(crate) fn header(&self) -> String {
        format!(
            "@@ -{},{} +{},{} @@",
            self.old_start, self.old_len, self.new_start, self.new_len
        )
    }
}

/// Outcome of [`unified`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Diff {
    /// The two texts are identical.
    Same,
    /// Hunks in order. `truncated` is set when [`MAX_OUTPUT_LINES`] cut the
    /// list short.
    Changed { hunks: Vec<Hunk>, truncated: bool },
    /// A cap refused the pair; the string says which.
    TooLarge(&'static str),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Op {
    Keep,
    Delete,
    Insert,
}

/// Unified line diff from `old` to `new`, bounded by this module's caps.
pub(crate) fn unified(old: &str, new: &str) -> Diff {
    if old == new {
        return Diff::Same;
    }
    if old.len() > MAX_INPUT_BYTES || new.len() > MAX_INPUT_BYTES {
        return Diff::TooLarge("a version is larger than the diff limit");
    }
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    if a.len() > MAX_INPUT_LINES || b.len() > MAX_INPUT_LINES {
        return Diff::TooLarge("a version has more lines than the diff limit");
    }
    let Some(ops) = edit_script(&a, &b) else {
        return Diff::TooLarge("the versions differ in more lines than the diff limit");
    };
    if ops.iter().all(|op| *op == Op::Keep) {
        // Same lines, different line endings or trailing newline.
        return Diff::Changed {
            hunks: Vec::new(),
            truncated: false,
        };
    }
    let (hunks, truncated) = hunks(&a, &b, &ops);
    Diff::Changed { hunks, truncated }
}

/// The shortest edit script, or `None` past [`MAX_EDIT_DISTANCE`].
fn edit_script(a: &[&str], b: &[&str]) -> Option<Vec<Op>> {
    let prefix = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let mid_a = &a[prefix..a.len() - suffix];
    let mid_b = &b[prefix..b.len() - suffix];
    let mut ops = vec![Op::Keep; prefix];
    ops.extend(myers(mid_a, mid_b)?);
    ops.extend(std::iter::repeat_n(Op::Keep, suffix));
    Some(ops)
}

/// Myers' greedy forward search, keeping one frontier per edit step so the
/// path can be walked back.
fn myers(a: &[&str], b: &[&str]) -> Option<Vec<Op>> {
    let n = a.len();
    let m = b.len();
    let max = n + m;
    if max == 0 {
        return Some(Vec::new());
    }
    let limit = max.min(MAX_EDIT_DISTANCE);
    // `v[k + offset]` is the furthest x reached on diagonal k = x - y.
    let offset = limit + 1;
    let mut v = vec![0usize; 2 * limit + 3];
    let mut trace: Vec<Vec<usize>> = Vec::new();
    for d in 0..=limit {
        trace.push(v.clone());
        let d_i = d as isize;
        let mut k = -d_i;
        while k <= d_i {
            let idx = (k + offset as isize) as usize;
            let mut x = if k == -d_i || (k != d_i && v[idx - 1] < v[idx + 1]) {
                v[idx + 1]
            } else {
                v[idx - 1] + 1
            };
            let mut y = (x as isize - k) as usize;
            while x < n && y < m && a[x] == b[y] {
                x += 1;
                y += 1;
            }
            v[idx] = x;
            if x >= n && y >= m {
                return Some(backtrack(&trace, offset, n, m));
            }
            k += 2;
        }
    }
    None
}

fn backtrack(trace: &[Vec<usize>], offset: usize, n: usize, m: usize) -> Vec<Op> {
    let mut ops = Vec::with_capacity(n + m);
    let mut x = n as isize;
    let mut y = m as isize;
    for (d, v) in trace.iter().enumerate().rev() {
        let d = d as isize;
        let k = x - y;
        let at = |k: isize| v[(k + offset as isize) as usize] as isize;
        let prev_k = if k == -d || (k != d && at(k - 1) < at(k + 1)) {
            k + 1
        } else {
            k - 1
        };
        let prev_x = if d == 0 { 0 } else { at(prev_k) };
        let prev_y = if d == 0 { 0 } else { prev_x - prev_k };
        while x > prev_x && y > prev_y {
            ops.push(Op::Keep);
            x -= 1;
            y -= 1;
        }
        if d > 0 {
            ops.push(if x == prev_x { Op::Insert } else { Op::Delete });
        }
        x = prev_x;
        y = prev_y;
    }
    ops.reverse();
    ops
}

/// Group an edit script into hunks with [`CONTEXT`] lines around each run of
/// changes, stopping at [`MAX_OUTPUT_LINES`].
fn hunks(a: &[&str], b: &[&str], ops: &[Op]) -> (Vec<Hunk>, bool) {
    // Positions in each text before every op.
    let mut positions = Vec::with_capacity(ops.len());
    let (mut ia, mut ib) = (0usize, 0usize);
    for op in ops {
        positions.push((ia, ib));
        match op {
            Op::Keep => {
                ia += 1;
                ib += 1;
            }
            Op::Delete => ia += 1,
            Op::Insert => ib += 1,
        }
    }
    let changes: Vec<usize> = (0..ops.len()).filter(|&i| ops[i] != Op::Keep).collect();
    let mut out = Vec::new();
    let mut emitted = 0usize;
    let mut i = 0usize;
    while i < changes.len() {
        let start = changes[i].saturating_sub(CONTEXT);
        let mut end = changes[i];
        // Merge changes whose context windows touch.
        while i + 1 < changes.len() && changes[i + 1] <= end + 2 * CONTEXT + 1 {
            i += 1;
            end = changes[i];
        }
        let end = (end + CONTEXT + 1).min(ops.len());
        let (old_first, new_first) = positions[start];
        let mut lines = Vec::new();
        let (mut old_len, mut new_len) = (0usize, 0usize);
        for j in start..end {
            if emitted >= MAX_OUTPUT_LINES {
                if !lines.is_empty() {
                    out.push(Hunk {
                        old_start: start_of(old_first, old_len),
                        old_len,
                        new_start: start_of(new_first, new_len),
                        new_len,
                        lines,
                    });
                }
                return (out, true);
            }
            let (pa, pb) = positions[j];
            let line = match ops[j] {
                Op::Keep => {
                    old_len += 1;
                    new_len += 1;
                    DiffLine {
                        op: ' ',
                        text: a[pa].to_owned(),
                    }
                }
                Op::Delete => {
                    old_len += 1;
                    DiffLine {
                        op: '-',
                        text: a[pa].to_owned(),
                    }
                }
                Op::Insert => {
                    new_len += 1;
                    DiffLine {
                        op: '+',
                        text: b[pb].to_owned(),
                    }
                }
            };
            lines.push(line);
            emitted += 1;
        }
        out.push(Hunk {
            old_start: start_of(old_first, old_len),
            old_len,
            new_start: start_of(new_first, new_len),
            new_len,
            lines,
        });
        i += 1;
    }
    (out, false)
}

/// Unified-diff convention: a side the hunk does not touch starts at the line
/// before it (0 at the top of the file).
fn start_of(first: usize, len: usize) -> usize {
    if len == 0 { first } else { first + 1 }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(diff: &Diff) -> String {
        match diff {
            Diff::Same => "same".into(),
            Diff::TooLarge(why) => format!("too large: {why}"),
            Diff::Changed { hunks, truncated } => {
                let mut out = String::new();
                for hunk in hunks {
                    out.push_str(&hunk.header());
                    out.push('\n');
                    for line in &hunk.lines {
                        out.push(line.op);
                        out.push_str(&line.text);
                        out.push('\n');
                    }
                }
                if *truncated {
                    out.push_str("[truncated]\n");
                }
                out
            }
        }
    }

    #[test]
    fn identical_texts_are_the_same() {
        assert_eq!(unified("a\nb\n", "a\nb\n"), Diff::Same);
    }

    #[test]
    fn one_changed_line_gets_context_and_headers() {
        let old = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
        let new = "1\n2\n3\n4\nfive\n6\n7\n8\n9\n";
        assert_eq!(
            render(&unified(old, new)),
            "@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n"
        );
    }

    #[test]
    fn insertions_and_deletions_at_the_edges() {
        assert_eq!(render(&unified("", "a\nb\n")), "@@ -0,0 +1,2 @@\n+a\n+b\n");
        assert_eq!(render(&unified("a\nb\n", "")), "@@ -1,2 +0,0 @@\n-a\n-b\n");
        assert_eq!(
            render(&unified("b\n", "a\nb\nc\n")),
            "@@ -1,1 +1,3 @@\n+a\n b\n+c\n"
        );
    }

    #[test]
    fn distant_changes_are_separate_hunks() {
        let old: String = (1..=30).map(|i| format!("{i}\n")).collect();
        let new: String = (1..=30)
            .map(|i| match i {
                2 => "two\n".to_owned(),
                28 => "twenty-eight\n".to_owned(),
                _ => format!("{i}\n"),
            })
            .collect();
        let Diff::Changed { hunks, truncated } = unified(&old, &new) else {
            panic!("expected a change");
        };
        assert!(!truncated);
        assert_eq!(hunks.len(), 2, "{}", render(&unified(&old, &new)));
        assert_eq!(hunks[0].header(), "@@ -1,5 +1,5 @@");
        assert_eq!(hunks[1].header(), "@@ -25,6 +25,6 @@");
    }

    #[test]
    fn the_script_is_minimal_and_reproduces_the_new_text() {
        let old = "a\nb\nc\na\nb\nb\na\n";
        let new = "c\nb\na\nb\na\nc\n";
        let Diff::Changed { hunks, .. } = unified(old, new) else {
            panic!("expected a change");
        };
        let lines: Vec<&DiffLine> = hunks.iter().flat_map(|h| &h.lines).collect();
        let edits = lines.iter().filter(|l| l.op != ' ').count();
        // The classic Myers example: five edits.
        assert_eq!(edits, 5);
        let rebuilt: Vec<&str> = lines
            .iter()
            .filter(|l| l.op != '-')
            .map(|l| l.text.as_str())
            .collect();
        assert_eq!(rebuilt, new.lines().collect::<Vec<_>>());
        let original: Vec<&str> = lines
            .iter()
            .filter(|l| l.op != '+')
            .map(|l| l.text.as_str())
            .collect();
        assert_eq!(original, old.lines().collect::<Vec<_>>());
    }

    /// Every pair over a small alphabet: the script must rebuild both texts
    /// and be as short as the LCS says it can be.
    #[test]
    fn scripts_are_valid_and_minimal_against_a_brute_force_lcs() {
        fn lcs(a: &[&str], b: &[&str]) -> usize {
            let mut t = vec![vec![0usize; b.len() + 1]; a.len() + 1];
            for i in 0..a.len() {
                for j in 0..b.len() {
                    t[i + 1][j + 1] = if a[i] == b[j] {
                        t[i][j] + 1
                    } else {
                        t[i][j + 1].max(t[i + 1][j])
                    };
                }
            }
            t[a.len()][b.len()]
        }
        // A tiny deterministic generator; no new dependency for a test.
        let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let alphabet = ["a", "b", "c"];
        for _ in 0..2_000 {
            let len_a = (next() % 9) as usize;
            let len_b = (next() % 9) as usize;
            let a: Vec<&str> = (0..len_a)
                .map(|_| alphabet[(next() % 3) as usize])
                .collect();
            let b: Vec<&str> = (0..len_b)
                .map(|_| alphabet[(next() % 3) as usize])
                .collect();
            let ops = edit_script(&a, &b).expect("small inputs stay under the cap");
            let (mut ia, mut ib) = (0, 0);
            for op in &ops {
                match op {
                    Op::Keep => {
                        assert_eq!(a[ia], b[ib], "{a:?} -> {b:?}");
                        ia += 1;
                        ib += 1;
                    }
                    Op::Delete => ia += 1,
                    Op::Insert => ib += 1,
                }
            }
            assert_eq!((ia, ib), (a.len(), b.len()), "{a:?} -> {b:?}");
            let edits = ops.iter().filter(|op| **op != Op::Keep).count();
            assert_eq!(edits, a.len() + b.len() - 2 * lcs(&a, &b), "{a:?} -> {b:?}");
        }
    }

    #[test]
    fn caps_refuse_oversized_input_and_edit_distance() {
        let big = "x".repeat(MAX_INPUT_BYTES + 1);
        assert!(matches!(unified(&big, "y"), Diff::TooLarge(_)));

        let many: String = (0..=MAX_INPUT_LINES).map(|i| format!("{i}\n")).collect();
        assert!(matches!(unified(&many, "y"), Diff::TooLarge(_)));

        // Every line differs: the distance is twice the line count.
        let old: String = (0..MAX_EDIT_DISTANCE).map(|i| format!("a{i}\n")).collect();
        let new: String = (0..MAX_EDIT_DISTANCE).map(|i| format!("b{i}\n")).collect();
        assert!(matches!(unified(&old, &new), Diff::TooLarge(_)));
        // Under the distance cap the same shape diffs.
        let old: String = (0..100).map(|i| format!("a{i}\n")).collect();
        let new: String = (0..100).map(|i| format!("b{i}\n")).collect();
        assert!(matches!(unified(&old, &new), Diff::Changed { .. }));
    }

    #[test]
    fn output_is_cut_at_the_line_cap() {
        let old: String = (0..MAX_INPUT_LINES / 2).map(|i| format!("{i}\n")).collect();
        // 500 changed lines (an edit distance of 1000, inside the cap), close
        // enough that their context merges into one run longer than the cap.
        let new: String = (0..MAX_INPUT_LINES / 2)
            .map(|i| {
                if i % 7 == 0 && i < 3_500 {
                    format!("changed {i}\n")
                } else {
                    format!("{i}\n")
                }
            })
            .collect();
        let Diff::Changed { hunks, truncated } = unified(&old, &new) else {
            panic!("expected a change");
        };
        assert!(truncated);
        let lines: usize = hunks.iter().map(|h| h.lines.len()).sum();
        assert_eq!(lines, MAX_OUTPUT_LINES);
    }

    #[test]
    fn a_line_ending_only_change_reports_no_hunks() {
        assert_eq!(
            unified("a\nb", "a\nb\n"),
            Diff::Changed {
                hunks: Vec::new(),
                truncated: false
            }
        );
    }
}
