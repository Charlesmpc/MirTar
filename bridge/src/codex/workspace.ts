import { mkdir, stat, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const WORKSPACE_ERROR = 'session_workspace_unavailable';
export function defaultWorkspace(home = homedir()) {
  return join(home, 'MirTar', 'workspaces', 'default');
}

// Never recreate a missing configured directory: it may be an unmounted project.
export async function checkWorkspace(cwd: string, create = false): Promise<void> {
  let probe: string | undefined;
  try {
    if (!isAbsolute(cwd)) throw Error('absolute_path_required');
    if (create) await mkdir(cwd, { recursive: true });
    if (!(await stat(cwd)).isDirectory()) throw Error('directory_required');
    probe = join(cwd, '.mirtar-write-check-' + randomUUID());
    await writeFile(probe, '', { flag: 'wx' });
    await unlink(probe); probe = undefined;
  } catch {
    throw Error(WORKSPACE_ERROR);
  } finally {
    if (probe) await unlink(probe).catch(() => {});
  }
}
