import test from 'node:test';
import assert from 'node:assert/strict';
import {pathwayHref,pathwaySteps} from '../lib/workspace-pathways';
import {activeWorkspaceTool,workspaceBusiness} from '../lib/workspace-navigation';
test('Build and Growth links preserve the business across both pathways and existing tools',()=>{
 for(const pathway of ['build','growth'] as const){
  const business='business / & +',route=new URL(pathwayHref(pathway,business),'https://workspace.test');
  assert.equal(route.pathname,'/workspace/'+pathway);assert.equal(workspaceBusiness(route.search),business);assert.equal(activeWorkspaceTool(route.pathname),'pathway');
  for(const step of pathwaySteps(pathway,business)){const url=new URL(step.href,route);assert.equal(workspaceBusiness(url.search),business);assert.ok(step.label);assert.equal(url.origin,route.origin);}
 }
});
