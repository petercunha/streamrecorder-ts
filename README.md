# streamrecorder-ts

`streamrecorder-ts` is a cross-platform CLI + daemon that automatically records livestreams with [Streamlink](https://streamlink.github.io/).

Add channels once, run the daemon, and recordings start when streams go live.

## What it does

- Monitors targets on a poll interval.
- Starts/stops Streamlink recording sessions automatically.
- Stores targets, sessions, and config in SQLite.
- Exposes CLI controls for targets, daemon lifecycle, and config.
- Supports autostart on Linux, macOS, and Windows.

## Requirements

- Node.js `>=20`
- `streamlink` installed and available on `PATH`

## Install

```bash
npm install
npm run build
npm link
```

After `npm link`, the `sr` command is available globally.

## Quick start

```bash
sr add ninja
sr daemon start
sr status
```

Add more targets:

```bash
sr add shroud 720p60
sr add https://www.youtube.com/@example best
sr add https://kick.com/somechannel
```

## Command reference

Top-level commands:

```bash
sr add <target> [quality]
sr rm|del <target>
sr ls|list [--json]
sr status [--json]
sr edit <target> [--quality <q>] [--enabled <bool>] [--name <displayName>] [--url <target>]
sr stats [--json]
sr config list|get|set
sr daemon start|stop|status|enable|disable
```

Useful help pages:

```bash
sr --help
sr config --help
sr daemon --help
```

## Target input behavior

- Bare names default to Twitch. Example: `sr add ninja` becomes `https://twitch.tv/ninja`.
- URLs are normalized (trailing slash removed, hash removed).
- Platform is inferred from URL host: Twitch, YouTube, Kick, or `generic`.

## Quality selection behavior

When requested quality is unavailable:

- Exact match is used if available.
- Otherwise, nearest lower/equal height is chosen.
- At the same height, `60fps` is preferred.
- If no lower/equal height exists, nearest available quality is chosen.

`best` and `worst` are passed through directly.

## Configuration

Default paths:

- Config/state directory: `~/.config/streamrecorder`
- Database: `~/.config/streamrecorder/state.db`
- Recordings: `~/Videos/StreamRecorder`

View current config:

```bash
sr config list
```

Set values:

```bash
sr config set defaultQuality 720p60
sr config set pollIntervalSec 45
sr config set streamlinkPath /usr/local/bin/streamlink
sr config set recordingsDir ~/Videos/StreamRecorder
```

Supported config keys:

- `recordingsDir`
- `defaultQuality`
- `pollIntervalSec` (integer `>=15`)
- `probeTimeoutSec` (integer `>=5`)
- `streamlinkPath`
- `logLevel` (`debug|info|warn|error`)
- `maxConcurrentRecordings` (integer `>=0`, `0` means no limit)
- `filenameTemplate` (tokens: `{slug}`, `{startedAt}`, `{quality}`)
- `configDir` (special key handled via bootstrap metadata)

Use a one-off config directory for smoke tests:

```bash
sr --config-dir /tmp/sr-dev add ninja
sr --config-dir /tmp/sr-dev daemon start
```

## Daemon and autostart

Daemon controls:

```bash
sr daemon start
sr daemon status
sr daemon stop
```

Enable autostart:

```bash
sr daemon enable
sr daemon disable
```

Platform details:

- Linux: creates `~/.config/systemd/user/streamrecorder.service`
- macOS: creates `~/Library/LaunchAgents/com.streamrecorder.daemon.plist`
- Windows: creates Task Scheduler task `StreamRecorderDaemon`

Linux note:

`systemd --user` services usually start after login. For start-at-boot behavior before login, enable lingering:

```bash
sudo loginctl enable-linger <username>
```

## Development

```bash
npm run dev
npm run build
npm test
npm run test:watch
```

## Troubleshooting

- `streamlink` not found:
  - Set `streamlinkPath`, for example `sr config set streamlinkPath /full/path/to/streamlink`
- Daemon not responding:
  - Check `sr daemon status`, then restart with `sr daemon stop` and `sr daemon start`
- No recordings produced:
  - Verify target URL/name, quality, and `recordingsDir`
