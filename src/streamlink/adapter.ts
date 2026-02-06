import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { ProbeResult } from "../shared/types.js";

export interface StreamlinkAdapterOptions {
  binaryPath: string;
  probeTimeoutSec: number;
}

export class StreamlinkAdapter {
  constructor(private readonly options: StreamlinkAdapterOptions) {}

  assertAvailable(): void {
    const result = spawnSync(this.options.binaryPath, ["--version"], {
      stdio: "ignore"
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Unable to execute streamlink binary at '${this.options.binaryPath}'. Set config streamlinkPath to a valid executable.`
      );
    }
  }

  async probe(url: string): Promise<ProbeResult> {
    const { exitCode, stdout, stderr } = await runCommand({
      cmd: this.options.binaryPath,
      args: ["--json", url],
      timeoutMs: this.options.probeTimeoutSec * 1000
    });

    const parsed = safeParseJson(stdout);
    if (parsed && typeof parsed === "object" && parsed !== null && "streams" in parsed) {
      const streams = parsed.streams;
      const qualities =
        streams && typeof streams === "object"
          ? Object.keys(streams as Record<string, unknown>)
          : [];

      return {
        isLive: qualities.length > 0,
        availableQualities: qualities,
        rawJson: parsed,
        error: exitCode === 0 ? undefined : stderr.trim() || `streamlink exited with ${exitCode}`
      };
    }

    if (exitCode === 0) {
      return {
        isLive: false,
        availableQualities: [],
        rawJson: parsed,
        error: undefined
      };
    }

    return {
      isLive: false,
      availableQualities: [],
      error: stderr.trim() || `streamlink exited with ${exitCode}`
    };
  }

  spawnRecording(url: string, quality: string, outputPath: string): ChildProcess {
    return spawn(this.options.binaryPath, [url, quality, "--output", outputPath], {
      stdio: "ignore"
    });
  }
}

function safeParseJson(input: string): unknown | null {
  if (!input.trim()) {
    return null;
  }
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function runCommand(input: {
  cmd: string;
  args: string[];
  timeoutMs: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(input.cmd, input.args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}\nprobe timeout` : stderr
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message
      });
    });
  });
}
