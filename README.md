# streamrecorder-ts

Cross-platform stream recorder CLI + daemon written in TypeScript. It uses `streamlink` to detect when streams are live and to record them.

## Prerequisites

- Node.js 20+
- `streamlink` installed and available in `PATH` (or set `streamlinkPath` in config)

## Install

```bash
npm install
npm run build
npm link
```

This exposes the `sr` command.

## Usage

```bash
sr add <stream-link-or-name> [quality]
sr rm <stream-link-or-name-or-id>
sr ls
sr status
sr edit <stream-link-or-name-or-id> [--quality <q>] [--enabled <bool>] [--name <alias>] [--url <url-or-name>]
sr stats
sr config list
sr config get <key>
sr config set <key> <value>
sr daemon start|stop|status|enable|disable
sr help
```

If a bare streamer name is provided, Twitch is assumed.
`sr status` is an alias of `sr ls/list` and includes an `isRecording`/`recording` flag per target.

## Storage

By default, state lives in:

- `~/.config/streamrecorder/state.db`

Recordings default to:

- `~/Videos/StreamRecorder`

You can move the config directory with:

```bash
sr config set configDir /path/to/new/config
```

## Notes

- The daemon checks targets every `pollIntervalSec` (default `60`).
- Live checks use `streamlink --json <url>`.
- Recording uses `streamlink <url> <quality> --output <file>`.
- Quality fallback: exact match -> closest lower (prefers `60fps` at same height) -> closest available.
