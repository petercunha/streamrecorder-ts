export function isPidRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function formatIsoForFilename(input: Date = new Date()): string {
  return input.toISOString().replace(/[.:]/g, "-");
}
