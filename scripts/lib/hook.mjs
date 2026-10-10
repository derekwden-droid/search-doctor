// What search-doctor does on each hook event.
//
// PreToolUse on Bash and PowerShell: fixes grep flags in rg commands before they run, through
// updatedInput, and tells Claude what changed.
// PostToolBatch: when a Grep call or an rg/grep command found nothing and its pattern is in the
// wrong regex dialect, tells Claude the empty result may come from the pattern, not the code.

import { fixRgFlags, grepPatternIssue, rgPatternIssue, searchesIn } from './rules.mjs';

const MAX_CONTEXT = 4000;
const SHELLS = new Set(['Bash', 'PowerShell']);

// The text of a tool result, whether it arrives as a string, content blocks or an object.
export function responseText(response) {
  if (typeof response === 'string') return response;
  if (Array.isArray(response)) return response.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  if (response && typeof response === 'object') {
    if (Array.isArray(response.content)) return responseText(response.content);
    if (typeof response.content === 'string') return response.content;
    if (typeof response.stdout === 'string') return response.stdout;
  }
  return '';
}

export function foundNothing(tool, text) {
  const t = String(text || '').trim();
  if (tool === 'Grep') return /^(No matches found|No files found|Found 0 )/.test(t);
  return t === '' || /^\((Bash|PowerShell) completed with no output\)$/.test(t);
}

function code(text) {
  return '`' + String(text).replace(/`/g, "'") + '`';
}

function quoteShell(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

// PreToolUse: the rewritten command, or null.
export function handlePreToolUse(input) {
  if (!input || !SHELLS.has(input.tool_name)) return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (typeof toolInput.command !== 'string') return null;
  const fix = fixRgFlags(toolInput.command);
  if (!fix) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: { ...toolInput, command: fix.command },
      additionalContext: 'search-doctor changed this rg command before it ran: ' + fix.notes.join('; ') + '. It ran as ' + code(fix.command) + '.',
    },
  };
}

function grepToolNote(call) {
  const pattern = call.tool_input && call.tool_input.pattern;
  const issue = rgPatternIssue(pattern);
  if (!issue) return null;
  return 'search-doctor: the Grep search for ' + code(pattern) + ' found nothing, and the pattern may be why. Grep uses ripgrep, where ' +
    issue.why + '. To search for what you meant, use the pattern ' + code(issue.fixed) + '.';
}

function shellNotes(call) {
  const command = call.tool_input && call.tool_input.command;
  if (typeof command !== 'string') return [];
  const notes = [];
  for (const search of searchesIn(command)) {
    for (const pattern of search.patterns) {
      if (search.tool === 'rg') {
        const issue = search.mode === 'fixed' ? null : rgPatternIssue(pattern);
        if (issue) {
          notes.push('search-doctor: the rg search for ' + code(pattern) + ' found nothing, and the pattern may be why: in ripgrep ' + issue.why +
            '. To search for what you meant, use ' + code(issue.fixed) + '.');
        }
        continue;
      }
      const issue = grepPatternIssue(pattern, search.mode);
      if (!issue) continue;
      const suggestion = issue.needsE ? 'grep -E ' + quoteShell(issue.fixed) : 'the pattern ' + quoteShell(issue.fixed);
      notes.push('search-doctor: the ' + search.tool + ' for ' + code(pattern) + ' found nothing, and the pattern may be why: ' + issue.why +
        '. To search for what you meant, use ' + code(suggestion) + (issue.needsE ? ', or rg.' : '.'));
    }
  }
  return notes;
}

// PostToolBatch: a note for each search that found nothing with a suspect pattern.
export function handleBatch(input) {
  const calls = input && Array.isArray(input.tool_calls) ? input.tool_calls : [];
  const notes = [];
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue;
    const tool = call.tool_name;
    if (tool !== 'Grep' && !SHELLS.has(tool)) continue;
    if (!foundNothing(tool, responseText(call.tool_response))) continue;
    if (tool === 'Grep') {
      const note = grepToolNote(call);
      if (note) notes.push(note);
    } else {
      notes.push(...shellNotes(call));
    }
  }
  if (!notes.length) return null;
  let context = [...new Set(notes)].join('\n');
  if (context.length > MAX_CONTEXT) context = context.slice(0, MAX_CONTEXT) + '\n(search-doctor output truncated)';
  return { hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: context } };
}

export function handle(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.hook_event_name === 'PreToolUse') return handlePreToolUse(input);
  if (input.hook_event_name === 'PostToolBatch') return handleBatch(input);
  return null;
}
