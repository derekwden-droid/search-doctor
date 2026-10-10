// Runs scripts/search-doctor.mjs the way Claude Code does: hook input as JSON on stdin, reply
// as JSON on stdout. Responses use the strings Claude Code really sends, captured live.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { foundNothing, responseText } from '../scripts/lib/hook.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/search-doctor.mjs', import.meta.url));

function run(input) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { SystemRoot: process.env.SystemRoot },
  });
  return { status: result.status, stderr: result.stderr, reply: result.stdout ? JSON.parse(result.stdout) : null };
}

const pre = (command, tool = 'Bash') => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command, description: 'search' }, tool_use_id: 't1' });
const batch = (...calls) => ({ hook_event_name: 'PostToolBatch', tool_calls: calls });
const grepCall = (pattern, response) => ({ tool_name: 'Grep', tool_input: { pattern, path: '/repo', output_mode: 'content' }, tool_response: response, tool_use_id: 'g1' });
const bashCall = (command, response) => ({ tool_name: 'Bash', tool_input: { command }, tool_response: response, tool_use_id: 'b1' });
const NONE = '(Bash completed with no output)';

test('rewrites rg -rn before it runs and says why', () => {
  const { status, reply } = run(pre('cd src && rg -rn generateTimeslots .'));
  assert.equal(status, 0);
  const out = reply.hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, undefined);
  assert.deepEqual(out.updatedInput, { command: 'cd src && rg -n generateTimeslots .', description: 'search' });
  assert.equal(out.additionalContext, 'search-doctor changed this rg command before it ran: -rn became -n (in ripgrep -r means --replace, which would have rewritten every match; ripgrep already searches folders recursively). It ran as `cd src && rg -n generateTimeslots .`.');
  assert.equal(run(pre('rg -rn foo .', 'PowerShell')).reply.hookSpecificOutput.updatedInput.command, 'rg -n foo .');
});

test('leaves other commands alone', () => {
  for (const command of ['npm test', 'grep -rn foo .', 'rg -n foo src', 'git log --oneline']) {
    const { status, reply } = run(pre(command));
    assert.equal(status, 0);
    assert.equal(reply, null, command);
  }
});

test('explains a Grep search for \\| that found nothing', () => {
  const { reply } = run(batch(grepCall('generateTimeslots\\|preventStray', 'No matches found')));
  assert.equal(reply.hookSpecificOutput.hookEventName, 'PostToolBatch');
  assert.equal(reply.hookSpecificOutput.additionalContext, 'search-doctor: the Grep search for `generateTimeslots\\|preventStray` found nothing, and the pattern may be why. Grep uses ripgrep, where \\| is a literal | character, not "or". To search for what you meant, use the pattern `generateTimeslots|preventStray`.');
  assert.ok(run(batch(grepCall('a\\|b', 'No files found'))).reply);
});

test('explains rg and grep searches in Bash that found nothing', () => {
  const rg = run(batch(bashCall("rg -n 'foo\\|bar' src", NONE))).reply.hookSpecificOutput.additionalContext;
  assert.match(rg, /^search-doctor: the rg search for `foo\\\|bar` found nothing, and the pattern may be why: in ripgrep \\\| is a literal \| character/);
  const grep = run(batch(bashCall("grep -rn 'foo|bar' .", NONE))).reply.hookSpecificOutput.additionalContext;
  assert.match(grep, /the grep for `foo\|bar` found nothing, and the pattern may be why: basic grep reads \| \+ \? \( \) \{ \} as plain characters\. To search for what you meant, use `grep -E 'foo\|bar'`, or rg\./);
  const digits = run(batch(bashCall("grep -rnE 'v\\d+' .", ''))).reply.hookSpecificOutput.additionalContext;
  assert.match(digits, /grep has no \\d \(it matches a plain d\)\. To search for what you meant, use `the pattern 'v\[0-9\]\+'`/);
});

test('says nothing when the search found something or the pattern is fine', () => {
  for (const call of [
    grepCall('a\\|b', 'Found 1 file\n/repo/a.ts'),
    grepCall('a|b', 'No matches found'),
    bashCall("rg -n 'a\\|b' .", './a.ts:1:a|b'),
    bashCall("grep -rnE 'a|b' .", NONE),
    bashCall('npm test', NONE),
    { tool_name: 'Read', tool_input: { file_path: 'x' }, tool_response: 'No matches found' },
  ]) {
    assert.equal(run(batch(call)).reply, null, JSON.stringify(call.tool_input));
  }
});

test('combines notes from one batch', () => {
  const { reply } = run(batch(grepCall('a\\|b', 'No matches found'), bashCall("grep -rn 'c|d' .", NONE)));
  assert.equal(reply.hookSpecificOutput.additionalContext.split('\n').length, 2);
});

test('reads tool results in their different shapes', () => {
  assert.equal(responseText([{ type: 'text', text: 'No matches found' }]), 'No matches found');
  assert.equal(responseText({ content: 'x' }), 'x');
  assert.equal(foundNothing('Grep', 'No matches found'), true);
  assert.equal(foundNothing('Grep', 'Found 2 files'), false);
  assert.equal(foundNothing('PowerShell', '(PowerShell completed with no output)'), true);
  assert.equal(foundNothing('Bash', 'something'), false);
});

test('fails open on bad input', () => {
  const bad = run('{"hook_event_name": "PreToolUse", "tool_name": "Bash", broken rg');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^search-doctor: /);
});
