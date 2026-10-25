import type {CustomerContext} from './context';
import {analyzeMessage, untrustedSystemRule, wrapUntrusted} from './untrusted';

// Contextual reply drafts. The deterministic draft always works; when a model is configured, its
// output replaces only the text, and the result is still a draft that needs approval.

export type ReplyDraft = {subject: string; body: string; ai_generated: boolean; summary: string; action_items: string[]; questions: string[]; flags: string[]; context_used: string[]};

export function summarizeThread(messages: {direction: string; text: string; occurred_at: string}[]): {summary: string; action_items: string[]; questions: string[]; flags: string[]} {
  const lastInbound = [...messages].reverse().find(m => m.direction === 'inbound');
  const analysis = lastInbound ? analyzeMessage(lastInbound.text) : {questions: [], promises: [], injection: []};
  const ours = messages.filter(m => m.direction === 'outbound').flatMap(m => analyzeMessage(m.text).promises.map(p => p.text));
  const first = lastInbound?.text.split(/\n/).map(s => s.trim()).find(s => s.length > 20) ?? '';
  return {
    summary: lastInbound ? `Latest customer message (${lastInbound.occurred_at.slice(0, 10)}): ${first.slice(0, 220)}${first.length > 220 ? '…' : ''}` : 'No customer message yet.',
    action_items: [...analysis.questions.map(q => `Answer: ${q}`), ...ours.map(p => `We promised: ${p}`)].slice(0, 8),
    questions: analysis.questions,
    flags: analysis.injection.map(f => f.kind),
  };
}

export function draftReply(ctx: CustomerContext, thread: {subject: string; messages: {direction: string; text: string; occurred_at: string}[]}, sender: {name: string; signature?: string}): ReplyDraft {
  const s = summarizeThread(thread.messages);
  const first = ctx.customer.name.split(' ')[0] || 'there';
  const facts = ctx.memory.facts.slice(0, 3).map(f => f.content);
  const meeting = ctx.meetings.find(m => m.status === 'scheduled');
  const lines = [`Hi ${first},`, '', `Thank you for your message${thread.subject ? ` about "${thread.subject.replace(/^re:\s*/i, '')}"` : ''}.`];
  if (s.questions.length) lines.push('', ...s.questions.map((q, i) => `${i + 1}. ${q}\n   [Answer here]`));
  if (meeting) lines.push('', `We are looking forward to our meeting on ${meeting.starts_at.slice(0, 10)}.`);
  else if (ctx.deals.some(d => d.outcome === 'open')) lines.push('', 'Would a short call this week help? Reply with a couple of times that suit you.');
  lines.push('', 'Best regards,', sender.name);
  return {subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject || 'your inquiry'}`, body: lines.join('\n'), ai_generated: false, ...s,
    context_used: [...facts.map(f => `Confirmed fact: ${f}`), ...(meeting ? [`Meeting ${meeting.starts_at.slice(0, 10)}`] : [])]};
}

/** Builds the model prompt for an AI-written variant; customer text is fenced as untrusted. */
export function draftPrompt(ctx: CustomerContext, thread: {subject: string; messages: {direction: string; text: string; occurred_at: string}[]}, sender: {name: string}) {
  const history = thread.messages.slice(-6).map(m => `${m.direction === 'inbound' ? 'Customer' : 'Us'} (${m.occurred_at.slice(0, 10)}):\n${m.direction === 'inbound' ? wrapUntrusted(m.text, 'email') : m.text.slice(0, 3000)}`).join('\n\n');
  return [
    {role: 'system', content: `You are Onyx, the Onixus Workspace assistant, writing a reply draft for ${sender.name}. The draft will be reviewed by a person before sending. ${untrustedSystemRule} Use only the confirmed facts given; do not invent prices, dates or commitments. Leave [brackets] where a person must fill in details.`},
    {role: 'user', content: `Customer: ${ctx.customer.name || ctx.customer.company} (${ctx.customer.company}).\nConfirmed facts:\n${ctx.memory.facts.map(f => `- ${f.content}`).join('\n') || '- none'}\nOpen opportunities: ${ctx.deals.filter(d => d.outcome === 'open').map(d => `${d.title} (${d.stage})`).join('; ') || 'none'}\n\nConversation "${thread.subject}":\n${history}\n\nWrite the reply body only.`},
  ];
}
