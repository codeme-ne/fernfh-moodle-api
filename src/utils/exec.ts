import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { getErrorMessage } from "./error.js";

const execFile = promisify(execFileCallback);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    maxBuffer?: number;
  } = {}
): Promise<CommandResult> {
  try {
    const result = await execFile(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    throw new Error(`Command "${command}" failed: ${getErrorMessage(error)}`);
  }
}
