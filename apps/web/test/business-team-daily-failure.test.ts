import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dailyFailure} from '../lib/business-team/daily-failure';

test('daily planning failures identify the stage without exposing provider details',()=>{
  assert.match(dailyFailure('context',new Error('database key secret')),/Business snapshot/);
  assert.match(dailyFailure('worker',new Error('503:Private Hermes authentication failed.')),/OIDC/);
  assert.match(dailyFailure('worker',new Error('503:Onixelia endpoint not found.')),/endpoint was not found/);
  assert.match(dailyFailure('worker',new Error('503:Onixelia request was rejected.')),/authorization/);
  assert.match(dailyFailure('receipt',new Error('database key secret')),/receipt could not be saved/);
  assert.doesNotMatch(dailyFailure('worker',new Error('private provider token: abc')),/abc/);
});
