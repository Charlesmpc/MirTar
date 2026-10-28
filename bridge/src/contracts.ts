export type Session = { id: string; name: string };
export type Reply = { turnId: string; text: string; completed: boolean; inputId?: string };
export type AnswerTarget = { interactionId: string; questionId: string };
export type AgentQuestion = AnswerTarget & { sessionId: string; turnId: string; header: string; text: string;
  index: number; count: number; options: { label: string; description: string }[];
  status: 'pending' | 'responding' | 'unknown' | 'blocked' };
export type AgentActivity = { turnId: string; inputId?: string; state: 'running' | 'completed' | 'failed' | 'interrupted' };
export interface AgentAudioInput {
  append(pcm16k: Buffer): void;
  commit(inputId: string, progress: (state: string) => void): Promise<{ submissionId: string }>;
}
export interface AgentAdapter {
  readonly id: string;
  sessions(): Promise<Session[]>;
  history(sessionId: string): Promise<Reply[]>;
  beginAudio(sessionId: string, signal: AbortSignal, onFailure?: (error: unknown) => void): AgentAudioInput;
  activateSession?(sessionId: string): Promise<void>;
  setupError?(): string | undefined;
  question?(sessionId: string): AgentQuestion | undefined;
  activity?(sessionId: string): AgentActivity | undefined;
  beginAnswerAudio?(sessionId: string, target: AnswerTarget, signal: AbortSignal, onFailure?: (error: unknown) => void): AgentAudioInput;
  answer?(sessionId: string, target: AnswerTarget, action: { option: number } | { skip: true }, signal: AbortSignal): Promise<{ submissionId: string }>;
  close(): Promise<void>;
}
export type BridgeConfig = {
  version: 1;
  listen: { host: string; port: number; allowLanPlaintext: boolean };
  bluetooth?: { enabled: boolean; hostName?: string };
  server?: { id: string; name: string };
  devices: { id: string; secret: string }[];
  codex: { bin: string; edgePath: string; defaultWorkingDirectory?: string; sessions: (Session & { execution?: 'desktop' | 'bridge'; cwd?: string })[] };
};
