export type Session = { id: string; name: string };
export type Reply = { turnId: string; text: string; completed: boolean; inputId?: string };
export interface AgentAdapter {
  readonly id: string;
  sessions(): Promise<Session[]>;
  history(sessionId: string): Promise<Reply[]>;
  submitAudio(sessionId: string, pcm16k: Buffer, inputId: string, signal: AbortSignal,
    progress: (state: string) => void): Promise<{ submissionId: string }>;
  close(): Promise<void>;
}
export type BridgeConfig = {
  version: 1;
  listen: { host: string; port: number; allowLanPlaintext: boolean };
  bluetooth?: { enabled: boolean; hostName?: string };
  devices: { id: string; secret: string }[];
  codex: { bin: string; edgePath: string; sessions: Session[] };
};
