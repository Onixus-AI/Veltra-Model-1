// Node DOM tests exercise component behavior; CSS/layout belongs to browser checks.
// Keep this helper scoped to tests that import styled page components.
import {createRequire} from 'node:module';
const testRequire=createRequire(process.cwd()+'/package.json');
testRequire.extensions['.css']=()=>{};
