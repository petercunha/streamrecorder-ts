import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface AutostartStatus {
  enabled: boolean;
  details: string;
}

export function enableAutostart(configDir: string): string {
  switch (process.platform) {
    case "linux":
      return enableLinux(configDir);
    case "darwin":
      return enableMac(configDir);
    case "win32":
      return enableWindows(configDir);
    default:
      throw new Error(`Autostart not supported on platform: ${process.platform}`);
  }
}

export function disableAutostart(): string {
  switch (process.platform) {
    case "linux":
      return disableLinux();
    case "darwin":
      return disableMac();
    case "win32":
      return disableWindows();
    default:
      throw new Error(`Autostart not supported on platform: ${process.platform}`);
  }
}

export function autostartStatus(): AutostartStatus {
  switch (process.platform) {
    case "linux":
      return linuxStatus();
    case "darwin":
      return macStatus();
    case "win32":
      return windowsStatus();
    default:
      return { enabled: false, details: "unsupported platform" };
  }
}

function daemonCommand(configDir: string): string {
  const nodePath = process.execPath;
  const entry = process.argv[1];
  if (!entry) {
    throw new Error("Unable to resolve CLI entrypoint for autostart setup");
  }

  return `${quote(nodePath)} ${quote(entry)} --config-dir ${quote(configDir)} daemon-run`;
}

function enableLinux(configDir: string): string {
  const serviceDir = path.join(os.homedir(), ".config", "systemd", "user");
  const servicePath = path.join(serviceDir, "streamrecorder.service");
  fs.mkdirSync(serviceDir, { recursive: true });

  const [nodePath, entryPath] = [process.execPath, process.argv[1]];
  if (!entryPath) {
    throw new Error("Unable to resolve entrypoint for Linux autostart");
  }

  const service = [
    "[Unit]",
    "Description=Stream Recorder Daemon",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${quote(nodePath)} ${quote(entryPath)} --config-dir ${quote(configDir)} daemon-run`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");

  fs.writeFileSync(servicePath, service, "utf8");
  runOrThrow("systemctl", ["--user", "daemon-reload"]);
  runOrThrow("systemctl", ["--user", "enable", "streamrecorder.service"]);
  runOrThrow("systemctl", ["--user", "start", "streamrecorder.service"]);
  return `Enabled via ${servicePath}`;
}

function disableLinux(): string {
  const servicePath = path.join(os.homedir(), ".config", "systemd", "user", "streamrecorder.service");
  spawnSync("systemctl", ["--user", "stop", "streamrecorder.service"], { stdio: "ignore" });
  spawnSync("systemctl", ["--user", "disable", "streamrecorder.service"], { stdio: "ignore" });
  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
  }
  spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  return "Disabled systemd user service";
}

function linuxStatus(): AutostartStatus {
  const servicePath = path.join(os.homedir(), ".config", "systemd", "user", "streamrecorder.service");
  if (!fs.existsSync(servicePath)) {
    return { enabled: false, details: "systemd service file not found" };
  }

  const enabled = spawnSync("systemctl", ["--user", "is-enabled", "streamrecorder.service"], {
    encoding: "utf8"
  });

  return {
    enabled: enabled.status === 0,
    details: enabled.stdout?.trim() || enabled.stderr?.trim() || "unknown"
  };
}

function enableMac(configDir: string): string {
  const plistDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(plistDir, "com.streamrecorder.daemon.plist");
  fs.mkdirSync(plistDir, { recursive: true });

  const [nodePath, entryPath] = [process.execPath, process.argv[1]];
  if (!entryPath) {
    throw new Error("Unable to resolve entrypoint for macOS autostart");
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.streamrecorder.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(entryPath)}</string>
    <string>--config-dir</string>
    <string>${escapeXml(configDir)}</string>
    <string>daemon-run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;

  const uid = getUidOrThrow();
  fs.writeFileSync(plistPath, plist, "utf8");
  spawnSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "ignore" });
  runOrThrow("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  return `Enabled via ${plistPath}`;
}

function disableMac(): string {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.streamrecorder.daemon.plist");
  const uid = getUidOrThrow();
  spawnSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "ignore" });
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  return "Disabled launch agent";
}

function macStatus(): AutostartStatus {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.streamrecorder.daemon.plist");
  const exists = fs.existsSync(plistPath);
  if (!exists) {
    return { enabled: false, details: "launch agent not found" };
  }

  const uid = getUidOrThrow();
  const list = spawnSync("launchctl", ["print", `gui/${uid}/com.streamrecorder.daemon`], {
    encoding: "utf8"
  });

  return {
    enabled: list.status === 0,
    details: list.status === 0 ? "loaded" : "plist exists but not loaded"
  };
}

function enableWindows(configDir: string): string {
  const taskName = "StreamRecorderDaemon";
  const command = daemonCommand(configDir);
  runOrThrow("schtasks", [
    "/Create",
    "/TN",
    taskName,
    "/SC",
    "ONLOGON",
    "/TR",
    command,
    "/F"
  ]);
  runOrThrow("schtasks", ["/Run", "/TN", taskName]);
  return `Enabled task ${taskName}`;
}

function disableWindows(): string {
  const taskName = "StreamRecorderDaemon";
  spawnSync("schtasks", ["/End", "/TN", taskName], { stdio: "ignore" });
  const result = spawnSync("schtasks", ["/Delete", "/TN", taskName, "/F"], {
    encoding: "utf8"
  });
  if (result.status === 0) {
    return `Disabled task ${taskName}`;
  }
  return `Task ${taskName} was not present`;
}

function windowsStatus(): AutostartStatus {
  const taskName = "StreamRecorderDaemon";
  const result = spawnSync("schtasks", ["/Query", "/TN", taskName], {
    encoding: "utf8"
  });

  return {
    enabled: result.status === 0,
    details: result.status === 0 ? "task exists" : "task not found"
  };
}

function runOrThrow(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || result.stdout?.trim() || `Command failed: ${cmd}`;
    throw new Error(stderr);
  }
}

function quote(value: string): string {
  if (/\s/.test(value)) {
    return `"${value.replaceAll("\"", '\\\"')}"`;
  }
  return value;
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getUidOrThrow(): number {
  if (typeof process.getuid !== "function") {
    throw new Error("Unable to resolve current user id on this platform");
  }
  return process.getuid();
}
