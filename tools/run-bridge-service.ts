import { resolve } from 'node:path';
import { runBridgeService } from '../bridge/src/service.ts';

const [config, stateDirectory] = process.argv.slice(2);
if (!config || !stateDirectory) throw Error('Provide local config and service state paths');
try {
  process.exitCode = await runBridgeService({ config: resolve(config), stateDirectory: resolve(stateDirectory), root: resolve(import.meta.dirname, '..') });
} catch {
  console.error('MirTar service could not start; inspect the local service log and configuration.');
  process.exitCode = 1;
}
