# search-doctor

Claude writes searches with grep habits, and two of them fail without a sound:

- **`rg -rn pattern`.** In grep `-r` means recursive. In ripgrep it means `--replace`, so `-rn` replaces every match with the letter `n`. The command exits 0 and Claude reads garbage such as `function n() {}` as the code. `rg -nr pattern` is worse: `-r` swallows the pattern, matches every character and prints walls of noise. Claude then blames an imaginary output filter instead of its flags. This is open on Anthropic's tracker as anthropics/claude-code 62016, with recent reports from Fable 5.
- **`\|` in ripgrep, `|` in basic grep.** Claude Code's own Grep tool runs ripgrep, where `foo\|bar` searches for a literal `foo|bar`. The result is "No matches found", and Claude concludes the code isn't there. Basic grep has the mirror problem: `grep 'foo|bar'`, `grep '\w+'` and `grep '\d'` treat `|`, `+` and `\d` as plain characters and find nothing.

search-doctor catches both:

- **Before an rg command runs,** it fixes grep flags that ripgrep reads differently. It takes `-r` out of clusters such as `-rn`, `-nr` and `-rln` (ripgrep already searches folders recursively). It turns `--include`, `--exclude` and `--exclude-dir` into `-g` globs, and drops grep's `-E`, which ripgrep reads as a file encoding. Claude is told what changed and why.
- **When a search finds nothing and its pattern is in the wrong dialect,** Claude is told the empty result may be the pattern, not the code, and gets the pattern to use. This covers the Grep tool and rg with `\|`, `\(` `\)` and `\{` `\}`, and basic grep with `|` `+` `?` `( )` `{ }` or `\d`.

Here is what Claude saw in a real session. First, `rg -rn generateTimeslots .` ran as `rg -n generateTimeslots .` and returned the real line, with this note:

```
search-doctor changed this rg command before it ran: -rn became -n (in ripgrep -r means --replace, which would have rewritten every match; ripgrep already searches folders recursively). It ran as `cd ".../rgtest" && rg -n generateTimeslots .`.
```

Then a Grep for `generateTimeslots\|preventStray` returned "No matches found", followed by:

```
search-doctor: the Grep search for `generateTimeslots\|preventStray` found nothing, and the pattern may be why. Grep uses ripgrep, where \| is a literal | character, not "or". To search for what you meant, use the pattern `generateTimeslots|preventStray`.
```

A correct search that finds things gets no note at all.

## Try it

1. "Use `rg -rn` to find where `main` is defined in this repository."
2. "Use the Grep tool to search for `TODO\|FIXME` in this repository."
3. "Run `grep -rn 'TODO|FIXME' .` and tell me what it finds."

The first runs as `rg -n` and returns real lines. The other two find nothing, and Claude is told why and searches again with the right pattern.

## What's included

- **Two hooks.** PreToolUse on Bash and PowerShell runs `node scripts/search-doctor.mjs` before each command and changes only rg commands with grep flags. PostToolBatch runs it after each batch of tool calls and speaks only when a search found nothing because of its pattern.

## What it reads, runs and sends

- **Reads** the command or search Claude is about to run, and the result Claude Code passes back after it ran. It reads no files.
- **Writes** nothing, and keeps no logs or state.
- **Runs** `node scripts/search-doctor.mjs` before each Bash or PowerShell command and after each batch of tool calls. When there's no search involved it exits at once, about 10 ms on top of starting Node, and about 35 ms when it acts.
- **Sends** nothing over the network. There is no telemetry and no account. See [PRIVACY.md](PRIVACY.md).

Its notes go into your conversation with Claude, like any other hook output.

## Limits

- It changes a command only in the cases above, where the grep meaning is unambiguous. `rg -r REPLACEMENT`, a quoted `"-rn"` pattern and anything after `--` are left alone, and so are commands with here-documents.
- The pattern notes appear only when a search found nothing, so a search that matched something with an odd pattern gets no comment.
- It reads commands with a small parser, not a full shell.
- If anything goes wrong inside the hook, the command runs unchanged, and Claude Code shows a hook error notice.

## Requirements

- A Claude Code version with exec-form hooks (`"command"` plus `"args"`) and the PostToolBatch event. Verified on 2.1.293 on Windows 11 with ripgrep 15.1.
- Node.js 20 or later on your `PATH`.

## Development

`node --test` runs the tests. They need nothing beyond Node.

## License

MIT. See [LICENSE](LICENSE).
