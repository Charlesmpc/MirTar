export interface MediaHandle { stop(): Promise<void> }
export interface MediaHost { openWebRtc(url: string, profilePath: string): Promise<MediaHandle> }
