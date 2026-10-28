import { createAgentSession } from '../bridge/src/codex/session-setup.ts';
import { WORKSPACE_ERROR } from '../bridge/src/codex/workspace.ts';

const [path, workingDirectory, name] = process.argv.slice(2);
if (!path) throw Error('Provide a local bridge config path');
createAgentSession(path, { workingDirectory: workingDirectory && workingDirectory !== '--default' ? workingDirectory : undefined, name: name || undefined })
  .then(() => console.log('Bridge-owned session saved. Restart the bridge, then select it on the card. Existing bindings and sessions are preserved.'))
  .catch(error => {
    console.error(error.message === WORKSPACE_ERROR
      ? 'Configure the bridge session working directory: use -WorkingDirectory with an existing writable project folder. Existing configuration was preserved.'
      : 'Agent session setup failed. Existing configuration was preserved; check Codex login and the local session-setup receipt. Do not delete device bindings.');
    process.exitCode = 1;
  });
