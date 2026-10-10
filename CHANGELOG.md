# Changelog

## 1.0.0 - 2026-10-10

- PreToolUse hook on Bash and PowerShell that fixes grep flags in rg commands before they run:
  `-r` inside clusters such as `-rn`, `-nr` and `-rln` (in ripgrep `-r` is `--replace`),
  `--include`, `--exclude` and `--exclude-dir` (turned into `-g` globs), and grep's `-E` (ripgrep
  reads it as a file encoding). Claude is told what changed and why.
- PostToolBatch hook that explains searches that found nothing because of their pattern: `\|`,
  `\( \)` and `\{ \}` in the Grep tool and rg, where they are literal characters, and ERE syntax
  or `\d` in basic grep.
- Leaves real ripgrep usage (`-r REPLACEMENT`, quoted patterns, anything after `--`) and every
  successful search alone.
