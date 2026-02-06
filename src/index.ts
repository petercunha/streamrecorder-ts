#!/usr/bin/env node
import { handleCliError, printHelpHint, runCli } from "./cli/program.js";

async function main(): Promise<void> {
  try {
    await runCli(process.argv);
  } catch (error) {
    const code = handleCliError(error);
    printHelpHint();
    process.exit(code);
  }
}

void main();
