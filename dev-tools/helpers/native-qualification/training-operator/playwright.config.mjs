// Closed one-case composition. No build, provider or service setup.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixedTrainingUiConfig} from './global-setup.mjs';
const FIXED_CONTEXT = null;
const operatorRelative=FIXED_CONTEXT?`.local-codex/native-training-host-operator/v2/${FIXED_CONTEXT.run_id}/${FIXED_CONTEXT.phase}`:'unbound';
const installed=fileURLToPath(import.meta.url),root=path.resolve(path.dirname(installed),'../../../../..');
if(FIXED_CONTEXT?.phase!=='training-ui'||installed!==path.join(root,operatorRelative,'playwright.config.mjs'))throw new Error('The fixed training UI configuration is unavailable.');
export default fixedTrainingUiConfig(root,path.join(root,operatorRelative,'global-setup.mjs'));
