export type Session = { id: string; name: string };
export type Reply = { turnId: string; text: string; completed: boolean; inputId?: string };
export interface AgentAudioInput {
  append(pcm16k: Buffer): void;
  commit(inputId: string, progress: (state: string) => void): Promise<{ submissionId: string }>;
}
export interface AgentAdapter {
  readonly id: string;
  sessions(): Promise<Session[]>;
  history(sessionId: string): Promise<Reply[]>;
  beginAudio(sessionId: string, signal: AbortSignal, onFailure?: (error: unknown) => void): AgentAudioInput;
  close(): Promise<void>;
}
export type BridgeConfig = {
  version: 1;
  listen: { host: string; port: number; allowLanPlaintext: boolean };
  bluetooth?: { enabled: boolean; hostName?: string };
  server?: { id: string; name: string };
  devices: { id: string; secret: string }[];
  codex: { bin: string; edgePath: string; sessions: Session[] };
};
