// Never print upstream error text: it can contain user input or local paths.
const publicCodes = new Set([
  'native_voice_error', 'native_voice_unavailable', 'native_voice_incomplete',
  'native_voice_failed', 'native_voice_timeout', 'native_transcript_timeout',
  'unexpected_voice_turn', 'incomplete_transcript', 'invalid_transcript',
  'media_engine_unavailable', 'input_cancelled', 'submission_unknown',
  'codex_timeout', 'codex_disconnected', 'bridge_busy', 'audio_backpressure', 'audio_limit',
]);

export function safeInputErrorCode(error: unknown): string {
  return error instanceof Error && publicCodes.has(error.message) ? error.message : 'input_failed';
}
