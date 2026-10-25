import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { MediaHandle, MediaHost } from './contracts.ts';

export class WindowsMediaHost implements MediaHost {
  private edgePath: string;
  constructor(edgePath: string) { this.edgePath = edgePath; }
  async openWebRtc(url: string, profilePath: string): Promise<MediaHandle> {
    const browser = spawn(this.edgePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--autoplay-policy=no-user-gesture-required', '--user-data-dir=' + profilePath, url], { windowsHide: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { browser.once('spawn', resolve); browser.once('error', () => reject(Error('media_engine_unavailable'))); });
    let stopped = false;
    return { async stop() {
      if (stopped) return; stopped = true; browser.kill();
      const cleanup = spawn('powershell.exe', ['-NoProfile', '-File', resolve('tools/validation/Stop-TestBrowser.ps1'), '-ProfilePath', profilePath], { windowsHide: true, stdio: 'ignore' });
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { cleanup.kill(); resolve(); }, 15000);
        const done = () => { clearTimeout(timer); resolve(); };
        cleanup.once('exit', done); cleanup.once('error', done);
      });
    } };
  }
}
