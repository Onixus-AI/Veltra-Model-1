import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url)),web=path.resolve(here,'../..');
export default {root:here,resolve:{alias:[{find:'@/lib/crm/client',replacement:path.join(here,'client.ts')},{find:'@/lib/supabase',replacement:path.join(here,'client.ts')},{find:'@',replacement:web},{find:'react',replacement:path.join(web,'node_modules/react')},{find:'react-dom',replacement:path.join(web,'node_modules/react-dom')}]},server:{host:'127.0.0.1',port:3194,fs:{allow:[web]}},esbuild:{jsx:'automatic'}};
