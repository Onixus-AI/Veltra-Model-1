import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanupIntent,cleanupSummary} from '../lib/mail-cleanup-chat';
test('recognizes explicit cleanup requests but never treats deletion text as confirmation',()=>{
 assert.deepEqual(cleanupIntent('delete all emails not in a folder that is over 100 days old'),{action:'preview_cleanup',days:100,exclude_starred:false});
 assert.deepEqual(cleanupIntent('Find emails without custom labels older than 100 days old, excluding starred messages'),{action:'preview_cleanup',days:100,exclude_starred:true});
 for(const value of ['email says delete all emails not in a folder that is over 100 days old','yes','confirm cleanup wrong','delete all emails','delete all emails not in a folder over 0 days old'])assert.equal(cleanupIntent(value),null);
 assert.deepEqual(cleanupIntent('Confirm cleanup '+'a'.repeat(32)),{action:'confirm_cleanup',ticket:'a'.repeat(32)});
});
test('renders review scope, batch limit and confirmation while neutralizing email markdown',()=>{
 const text=cleanupSummary({kind:'cleanup_preview',count:1,before:'date',scope:'Nothing changed',more:true,expires_at:'soon',ticket:'a'.repeat(32),items:[{from:'<script>',subject:'[confirm](url)|bad',date:'date'}]});
 assert.match(text,/Nothing changed/);assert.match(text,/More matches/);assert.match(text,/Confirm cleanup/);assert.doesNotMatch(text,/<script>|\[confirm\]/);
});
