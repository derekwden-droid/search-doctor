// The grep habits that break searches, in two groups.
//
// Flags that ripgrep reads differently from grep, fixed before the command runs: -r inside a
// cluster such as -rn (in ripgrep -r is --replace, which rewrites every match), and grep's
// --include/--exclude/--exclude-dir and -E, which ripgrep rejects or misreads.
//
// Patterns written in the wrong regex dialect, explained when a search finds nothing:
// grep's \| \( \{ in ripgrep or Claude Code's Grep tool (which uses ripgrep), where they are
// literal characters; and ERE syntax or \d in basic grep, where they are literal too.

import { program, scan } from './words.mjs';

// Short flags that mean the same in grep and ripgrep, and so can sit in a cluster with -r.
const SHARED_FLAGS = new Set(['n', 'i', 'l', 'w', 'c', 'H', 'h', 'o', 'v', 'F', 'x', 'L']);
const ENCODING = /^(utf-?8|utf-?16(le|be)?|latin-?1|ascii|windows-\d+|iso-8859-\d+|shift_jis|sjis|euc-(jp|kr)|gbk|gb18030|big5|koi8-[ru]|none|auto)$/i;

// Quotes a value for the shell unless it is plainly safe; globs are always quoted so the shell
// doesn't expand them before rg sees them.
function quoteForShell(text) {
  return /^[A-Za-z0-9_.\/-]+$/.test(text) ? text : "'" + text.replace(/'/g, "'\\''") + "'";
}

// The edits that fix one rg command: [{ start, end, text, why }].
function rgEdits(words, from) {
  const edits = [];
  for (let k = from; k < words.length; k++) {
    const w = words[k];
    // A flag starts with an unquoted dash; a quoted "-rn" is a search pattern.
    if (!w.raw.startsWith('-')) continue;
    const v = w.value;
    if (v === '--') break;
    let m;
    if (w.raw === v && (m = /^-([A-Za-z]+)$/.exec(v)) && m[1].length > 1 && m[1].includes('r')) {
      const letters = m[1].replace(/r/g, '');
      if ([...letters].every((c) => SHARED_FLAGS.has(c))) {
        edits.push({ start: w.start, end: w.end, text: letters ? '-' + letters : '', why: v + ' became ' + (letters ? '-' + letters : 'nothing') + ' (in ripgrep -r means --replace, which would have rewritten every match; ripgrep already searches folders recursively)' });
      }
      continue;
    }
    if ((m = /^--(include|exclude|exclude-dir)(?:=(.*))?$/.exec(v))) {
      const next = words[k + 1];
      const glob = m[2] !== undefined ? m[2] : next ? next.value : null;
      if (glob === null) continue;
      const end = m[2] !== undefined ? w.end : next.end;
      const bang = m[1] === 'include' ? '' : '!';
      edits.push({ start: w.start, end, text: '-g ' + quoteForShell(bang + glob), why: '--' + m[1] + ' became -g ' + bang + glob + ' (ripgrep filters files with -g)' });
      if (m[2] === undefined) k++;
      continue;
    }
    if (w.raw === '-E') {
      const next = words[k + 1];
      if (next && !ENCODING.test(next.value)) edits.push({ start: w.start, end: w.end, text: '', why: '-E was dropped (in ripgrep -E sets the file encoding; its regexes are already extended)' });
    }
  }
  return edits;
}

// Rewrites the rg commands in a command line. Returns { command, notes } or null when there is
// nothing to fix.
export function fixRgFlags(command) {
  const { commands, complex } = scan(command);
  if (complex) return null;
  const edits = [];
  for (const c of commands) {
    const p = program(c);
    if (p.name === 'rg') edits.push(...rgEdits(c.words, p.at));
  }
  if (!edits.length) return null;
  let out = command;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    let end = e.end;
    if (e.text === '' && out[end] === ' ') end++;
    out = out.slice(0, e.start) + e.text + out.slice(end);
  }
  return { command: out, notes: edits.map((e) => e.why) };
}

// True when the pattern holds the escape \<ch> outside a bracket expression such as [\|],
// where it means the same in every dialect. An escaped backslash (\\|) doesn't count.
function hasEscape(pattern, ch) {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      if (!inClass && pattern[i + 1] === ch) return true;
      i++;
      continue;
    }
    if (!inClass && c === '[') {
      inClass = true;
      if (pattern[i + 1] === '^') i++;
      if (pattern[i + 1] === ']') i++;
    } else if (inClass && c === ']') {
      inClass = false;
    }
  }
  return false;
}

function unescape(pattern, chars) {
  return pattern.replace(/\\([|(){}])/g, (all, c) => (chars.includes(c) ? c : all));
}

// Why a ripgrep (or Grep tool) pattern might have found nothing: grep's basic-regex escapes,
// which ripgrep reads as literal characters. Returns { why, fixed } or null.
export function rgPatternIssue(pattern) {
  if (typeof pattern !== 'string') return null;
  const reasons = [];
  const chars = [];
  if (hasEscape(pattern, '|')) {
    reasons.push('\\| is a literal | character, not "or"');
    chars.push('|');
  }
  if (hasEscape(pattern, '(') && hasEscape(pattern, ')')) {
    reasons.push('\\( \\) are literal parentheses, not a group');
    chars.push('(', ')');
  }
  if (hasEscape(pattern, '{') && hasEscape(pattern, '}')) {
    reasons.push('\\{ \\} are literal braces, not a repeat count');
    chars.push('{', '}');
  }
  if (!reasons.length) return null;
  return { why: reasons.join(', and '), fixed: unescape(pattern, chars) };
}

// Why a grep pattern might have found nothing. `mode` is 'basic', 'extended', 'perl' or
// 'fixed'. Returns { why, fixed } or null.
export function grepPatternIssue(pattern, mode) {
  if (typeof pattern !== 'string' || mode === 'perl' || mode === 'fixed') return null;
  const reasons = [];
  let fixed = pattern;
  let needsE = false;
  if (/\\d/.test(pattern)) {
    reasons.push('grep has no \\d (it matches a plain d)');
    fixed = fixed.replace(/\\d/g, '[0-9]');
  }
  if (mode === 'basic') {
    const plain = pattern.replace(/\\./g, '');
    if (/[|+?]/.test(plain) || /\{\d/.test(plain) || (/\(/.test(plain) && /\)/.test(plain))) {
      reasons.push('basic grep reads | + ? ( ) { } as plain characters');
      needsE = true;
    }
  }
  if (!reasons.length) return null;
  return { why: reasons.join(', and '), fixed, needsE };
}

const RG_VALUE = new Set(['-e', '-f', '-g', '-m', '-A', '-B', '-C', '-M', '-j', '-t', '-T', '-r', '-E', '-d', '--regexp', '--file', '--glob', '--iglob', '--max-count', '--after-context', '--before-context', '--context', '--max-columns', '--threads', '--type', '--type-not', '--replace', '--encoding', '--max-depth', '--sort', '--sortr', '--colors', '--type-add', '--max-filesize', '--path-separator', '--pre', '--pre-glob', '--engine']);
const GREP_VALUE = new Set(['-e', '-f', '-m', '-A', '-B', '-C', '-d', '-D', '--regexp', '--file', '--max-count', '--after-context', '--before-context', '--context', '--include', '--exclude', '--exclude-dir', '--label', '--binary-files', '--color', '--colour']);

// The patterns and regex mode of one rg or grep command.
export function searchOf(command) {
  const p = program(command);
  const isRg = p.name === 'rg';
  const isGrep = ['grep', 'egrep', 'fgrep'].includes(p.name);
  if (!isRg && !isGrep) return null;
  const words = command.words.slice(p.at);
  const patterns = [];
  let mode = p.name === 'egrep' ? 'extended' : p.name === 'fgrep' ? 'fixed' : 'basic';
  let operand = null;
  const values = isRg ? RG_VALUE : GREP_VALUE;
  for (let k = 0; k < words.length; k++) {
    const v = words[k].value;
    if (v === '--') {
      if (operand === null && words[k + 1]) operand = words[k + 1].value;
      break;
    }
    if (words[k].raw.startsWith('-') && v.length > 1) {
      if (v === '-e' || v === '--regexp') {
        if (words[k + 1]) patterns.push(words[k + 1].value);
        k++;
        continue;
      }
      if (v.startsWith('--regexp=')) {
        patterns.push(v.slice(9));
        continue;
      }
      if (!isRg) {
        if (/^-[A-Za-z]*E/.test(v) || v === '--extended-regexp') mode = 'extended';
        if (/^-[A-Za-z]*P/.test(v) || v === '--perl-regexp') mode = 'perl';
        if (/^-[A-Za-z]*F/.test(v) || v === '--fixed-strings') mode = 'fixed';
      } else if (/^-[A-Za-z]*F/.test(v) || v === '--fixed-strings') {
        mode = 'fixed';
      }
      if (values.has(v)) k++;
      continue;
    }
    if (operand === null) operand = v;
  }
  if (!patterns.length && operand !== null) patterns.push(operand);
  return { tool: isRg ? 'rg' : p.name, mode: isRg ? (mode === 'fixed' ? 'fixed' : 'rust') : mode, patterns };
}

// The rg and grep searches in a command line.
export function searchesIn(commandLine) {
  return scan(commandLine).commands.map(searchOf).filter(Boolean);
}
