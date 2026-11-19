import test from 'node:test';
import assert from 'node:assert/strict';
import { isFailureReply, withoutFailureReplies } from '../lib/chat-history';

test('saved failure replies are recognised', () => {
  for (const text of [
    'Onixus Workspace couldn’t complete this reply: The model provider could not complete this request. Try again, or choose another model.',
    "Onixus Workspace couldn't complete this reply. Please try again.",
    'Onyx cannot reach the Workspace AI service. Please try again after the service is restored.',
    'Onyx cannot reply because this workspace has no available AI credits. Check Settings for the balance and plan.',
    'Onyx cannot find this workspace’s credit account. Contact Onixus support; retrying this message will not fix the account.',
    'Onyx could not verify this workspace’s credit account. Please try again shortly.',
    'Please sign in again to continue chatting.',
    '**Request failed:** credit deduction failed',
  ]) assert.equal(isFailureReply(text), true, text);
});

test('real answers that mention failures are kept', () => {
  for (const text of [
    'Hi there — I’m Onyx, here to help with your Onixus Workspace.',
    'The quote request could not complete because the customer has not replied.',
    'Earlier, Onixus Workspace couldn’t complete this reply because the provider was down; it is fixed now.',
    '',
  ]) assert.equal(isFailureReply(text), false, text);
  assert.equal(isFailureReply(undefined), false);
});

test('only assistant failure replies are removed from model history', () => {
  const error = 'Onixus Workspace couldn’t complete this reply: The model provider could not complete this request. Try again, or choose another model.';
  const history = [
    { role: 'user' as const, content: 'try again' },
    { role: 'assistant' as const, content: error },
    { role: 'user' as const, content: error },
    { role: 'assistant' as const, content: 'Done.' },
  ];
  assert.deepEqual(withoutFailureReplies(history), [history[0], history[2], history[3]]);
});
