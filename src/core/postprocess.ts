export interface PostprocessDecisionInput {
  enabled: boolean;
  isStopping: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export function shouldPostprocessRecording(input: PostprocessDecisionInput): boolean {
  if (!input.enabled || input.isStopping) {
    return false;
  }

  if (input.exitCode === 0) {
    return true;
  }

  if (input.signal !== null) {
    return true;
  }

  // Some tools map signal exits into 128+signal codes and provide signal=null.
  return input.exitCode !== null && input.exitCode >= 128;
}
