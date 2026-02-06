# streamrecorder-ts

`streamrecorder-ts` is a cross-platform CLI + daemon that records livestreams with [Streamlink](https://streamlink.github.io/).

It polls configured targets, detects when they go live, and starts recording automatically.

## Features

- Add stream targets by URL or bare username (defaults to Twitch).
- Run as a background daemon with start/stop/status controls.
- Configure polling interval, default quality, output directory, and Streamlink binary path.
- Quality fallback logic:
  - exact match
  - closest lower quality (prefers 60fps variant at same height)
  - closest available quality if no lower one exists
- Linux/macOS/Windows autostart integration.

## Requirements

- Node.js 20+
- `streamlink` installed and reachable in `PATH`

## Install

```bash
npm install
npm run build
npm link
```

This exposes the `sr` command globally.

## Quick Start

```bash
sr add ninja
sr daemon start
sr status
```

Useful commands:

```bash
sr add <stream-link-or-name> [quality]
sr rm|del <target>
sr ls|list
sr status
sr edit <target> [--quality <q>] [--enabled <bool>] [--name <alias>] [--url <url-or-name>]
sr stats
sr config list|get|set
sr daemon start|stop|status|enable|disable
```

`sr status` is an alias of `sr ls/list` and includes current recording state per target.

## Configuration & Storage

Default locations:

- State DB: `~/.config/streamrecorder/state.db`
- Recordings: `~/Videos/StreamRecorder`

Change config directory:

```bash
sr config set configDir /path/to/config
```

Common config keys:

- `defaultQuality`
- `pollIntervalSec`
- `probeTimeoutSec`
- `recordingsDir`
- `streamlinkPath`

## Daemon Autostart Notes

### Linux (Ubuntu/systemd user service)

`sr daemon enable` creates a **systemd user** service (`~/.config/systemd/user/streamrecorder.service`).

Important: user services usually start after login. If you need recording to start at boot **before login**, enable lingering for that user:

```bash
sudo loginctl enable-linger <username>
```

Without lingering, the daemon may not run until the user session starts.

### macOS / Windows

- macOS uses a per-user LaunchAgent.
- Windows uses a per-user Task Scheduler task.

## Development

```bash
npm run dev
npm run build
npm test
npm run test:watch
```

## Troubleshooting

- `streamlink` not found: set `sr config set streamlinkPath /full/path/to/streamlink`
- Daemon not running: check `sr daemon status` and restart with `sr daemon start`
- For isolated testing, use `--config-dir /tmp/sr-dev`
