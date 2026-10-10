# search-doctor plugin privacy policy

Last updated: October 10, 2026

The search-doctor plugin for Claude Code collects no data. It has no servers, no accounts, no
analytics and no telemetry, and it never connects to the network.

## What the plugin accesses

Before each Bash or PowerShell command, Claude Code passes the plugin the command Claude is about
to run. After each batch of tool calls, it passes the calls in that batch and their results. The
plugin reads only search commands (rg and grep) and Grep tool calls, and only checks whether a
search found anything. It reads no files.

## What happens to that data

The plugin either says nothing or returns a short note to Claude: the corrected rg command and
why it changed, or why a search that found nothing may have used the wrong pattern. The note can
quote the command or pattern. When it corrects an rg command, the corrected command is the one
that runs. The plugin writes nothing to disk and keeps no logs, caches or copies.

Its notes become part of your conversation with Claude, like any other hook output. How Anthropic
handles your conversations is covered by Anthropic's own privacy policy, not this one.

## Retention

None. Nothing outlives the hook call that read it.

## Changes and contact

Changes to this policy are made in this file and recorded in the repository's history. Questions
go to [github.com/derekwden-droid/search-doctor/issues](https://github.com/derekwden-droid/search-doctor/issues).
