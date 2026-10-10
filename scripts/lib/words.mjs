// Splits a shell command line into simple commands and their words, keeping each word's
// position so a flag can be replaced in place. It understands single and double quotes,
// backslash escapes and the usual separators (; & | && || newlines and parentheses), which is
// enough for the search commands Claude writes in bash and PowerShell. Commands with
// here-documents or here-strings are marked complex and are never rewritten.

const SEPARATORS = ['&&', '||', '|&', ';;', '|', ';', '&', '(', ')', '\n'];

// Returns { commands: [{ words: [{ value, raw, start, end, quoted }] }], complex }.
export function scan(src) {
  const s = String(src);
  const commands = [];
  let words = [];
  const complex = /<<|@'|@"/.test(s);
  const flush = () => {
    if (words.length) commands.push({ words });
    words = [];
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '\\' && s[i + 1] === '\n') {
      i += 2;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    const sep = SEPARATORS.find((x) => s.startsWith(x, i));
    if (sep) {
      flush();
      i += sep.length;
      continue;
    }
    const start = i;
    let value = '';
    let quoted = false;
    while (i < s.length && !/[\s;&|()]/.test(s[i])) {
      const ch = s[i];
      if (ch === "'") {
        const end = s.indexOf("'", i + 1);
        const stop = end < 0 ? s.length : end;
        value += s.slice(i + 1, stop);
        quoted = true;
        i = stop + 1;
      } else if (ch === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') {
          if (s[j] === '\\' && (s[j + 1] === '"' || s[j + 1] === '\\' || s[j + 1] === '$' || s[j + 1] === '`')) {
            value += s[j + 1];
            j += 2;
          } else {
            value += s[j];
            j++;
          }
        }
        quoted = true;
        i = j + 1;
      } else if (ch === '\\' && i + 1 < s.length) {
        value += s[i + 1];
        quoted = true;
        i += 2;
      } else {
        value += ch;
        i++;
      }
    }
    words.push({ value, raw: s.slice(start, Math.min(i, s.length)), start, end: Math.min(i, s.length), quoted });
  }
  flush();
  return { commands, complex };
}

const PREFIXES = new Set(['sudo', 'command', 'builtin', 'exec', 'nohup', 'env', 'time', 'then', 'do', 'else', '!', '{']);

// The program a simple command runs (lower case, without a folder or .exe) and the index of
// its first argument.
export function program(command) {
  const w = command.words;
  let k = 0;
  while (k < w.length) {
    const v = w[k].value;
    if (!w[k].quoted && (PREFIXES.has(v) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(v))) {
      k++;
      while (k < w.length && w[k - 1].value === 'env' && w[k].value.startsWith('-')) k++;
      continue;
    }
    break;
  }
  if (k >= w.length) return { name: '', at: w.length };
  return { name: w[k].value.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, ''), at: k + 1 };
}
