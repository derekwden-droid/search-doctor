import test from 'node:test';
import assert from 'node:assert/strict';
import { fixRgFlags, grepPatternIssue, rgPatternIssue, searchesIn } from '../scripts/lib/rules.mjs';
import { program, scan } from '../scripts/lib/words.mjs';

const fixed = (cmd) => {
  const r = fixRgFlags(cmd);
  return r ? r.command : null;
};

test('splits commands into words with their positions', () => {
  const { commands } = scan('cd "my dir" && rg -n \'a b\' src | head -5; echo done');
  assert.deepEqual(commands.map((c) => c.words.map((w) => w.value)), [['cd', 'my dir'], ['rg', '-n', 'a b', 'src'], ['head', '-5'], ['echo', 'done']]);
  const rg = commands[1].words[2];
  assert.equal(rg.raw, "'a b'");
  assert.equal(program(commands[1]).name, 'rg');
  assert.equal(program(scan('FOO=1 sudo /usr/bin/rg.exe x').commands[0]).name, 'rg');
});

test('takes -r out of grep-style flag clusters in rg', () => {
  assert.equal(fixed('rg -rn generateTimeslots .'), 'rg -n generateTimeslots .');
  assert.equal(fixed('rg -nr foo src'), 'rg -n foo src');
  assert.equal(fixed('rg -rln "a b" src | head'), 'rg -ln "a b" src | head');
  assert.equal(fixed('cd app && rg -rni TODO .'), 'cd app && rg -ni TODO .');
  assert.equal(fixed('rg -rn foo . && rg -rl bar .'), 'rg -n foo . && rg -l bar .');
});

test('translates grep file filters and drops grep -E', () => {
  assert.equal(fixed('rg --include="*.ts" -n foo'), "rg -g '*.ts' -n foo");
  assert.equal(fixed('rg --include *.py foo .'), "rg -g '*.py' foo .");
  assert.equal(fixed('rg --include=src/app.ts foo'), 'rg -g src/app.ts foo');
  assert.equal(fixed('rg --exclude-dir node_modules foo .'), "rg -g '!node_modules' foo .");
  assert.equal(fixed('rg --exclude=*.min.js foo'), "rg -g '!*.min.js' foo");
  assert.equal(fixed('rg -E "a|b" .'), 'rg "a|b" .');
});

test('leaves real ripgrep usage alone', () => {
  for (const cmd of [
    "rg -r '$1' '(\\d+)px' src", 'rg --replace=x foo', 'rg -E utf-16 foo', 'rg -n -- -rn', 'rg -n "-rn" .', 'rg -rf patterns.txt',
    'grep -rn foo .', 'rg -n foo', "cat <<EOF | rg -rn x\nhi\nEOF", 'echo rg -rn foo',
  ]) {
    assert.equal(fixRgFlags(cmd), null, cmd);
  }
});

test('explains the reason for each rg change', () => {
  const r = fixRgFlags('rg -rn foo --include=*.ts .');
  assert.equal(r.notes.length, 2);
  assert.match(r.notes[0], /^-rn became -n \(in ripgrep -r means --replace/);
  assert.match(r.notes[1], /^--include became -g \*\.ts/);
});

test('spots grep escapes that ripgrep reads literally', () => {
  assert.deepEqual(rgPatternIssue('generateTimeslots\\|preventStray'), { why: '\\| is a literal | character, not "or"', fixed: 'generateTimeslots|preventStray' });
  assert.equal(rgPatternIssue('fn \\(\\w+\\)').fixed, 'fn (\\w+)');
  assert.equal(rgPatternIssue('a\\{2\\}').fixed, 'a{2}');
  for (const p of ['a|b', 'foo\\(', 'a\\\\|b', '\\d+', 'plain', '[\\|]', undefined]) {
    assert.equal(rgPatternIssue(p), null, String(p));
  }
});

test('spots extended syntax and \\d in grep', () => {
  assert.deepEqual(grepPatternIssue('foo|bar', 'basic'), { why: 'basic grep reads | + ? ( ) { } as plain characters', fixed: 'foo|bar', needsE: true });
  assert.equal(grepPatternIssue('\\w+', 'basic').needsE, true);
  assert.equal(grepPatternIssue('v\\d+', 'extended').fixed, 'v[0-9]+');
  assert.equal(grepPatternIssue('v\\d+', 'extended').needsE, false);
  for (const [p, mode] of [['foo\\|bar', 'basic'], ['foo', 'basic'], ['a|b', 'extended'], ['\\d+', 'perl'], ['a|b', 'fixed'], ['a\\+', 'basic']]) {
    assert.equal(grepPatternIssue(p, mode), null, p + ' ' + mode);
  }
});

test('finds the patterns and regex mode of each search in a command line', () => {
  const found = searchesIn("cd src && grep -rnE 'a|b' --include='*.ts' . | head; rg -n -e foo -e 'bar\\|baz' -g '*.md'; egrep x y; grep -F 'a|b' f; grep -P '\\d' f");
  assert.deepEqual(found, [
    { tool: 'grep', mode: 'extended', patterns: ['a|b'] },
    { tool: 'rg', mode: 'rust', patterns: ['foo', 'bar\\|baz'] },
    { tool: 'egrep', mode: 'extended', patterns: ['x'] },
    { tool: 'grep', mode: 'fixed', patterns: ['a|b'] },
    { tool: 'grep', mode: 'perl', patterns: ['\\d'] },
  ]);
});
