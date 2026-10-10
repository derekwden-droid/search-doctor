#!/usr/bin/env node
// search-doctor's hook entry point. The plugin's hooks.json runs it before Bash and PowerShell
// commands (PreToolUse) and after each batch of tool calls (PostToolBatch). It reads the hook
// input as JSON on standard input and prints a JSON reply only when a search command needs
// fixing or a search that found nothing needs explaining. Any error exits with status 1, which
// Claude Code reports without stopping the session.

// Most calls involve no search at all, so the rules load only when one might.
const RELEVANT = /\brg\b|grep|"Grep"/;

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  if (!RELEVANT.test(raw)) return;
  const { handle } = await import('./lib/hook.mjs');
  const reply = handle(JSON.parse(raw));
  if (reply) process.stdout.write(JSON.stringify(reply));
}

main().catch((err) => {
  process.stderr.write('search-doctor: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exitCode = 1;
});
