import fs from "node:fs";

export function ensureDirSync(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJsonFileSync<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function writeJsonFileSync(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
