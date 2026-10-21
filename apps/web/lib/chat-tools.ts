"use client";
import {toolPresentation,type TaskObserver} from './task-progress';
import type {TaskAccessClient} from './task-access-client';

import { connectionRequest } from "@/lib/connections-client";
import { gatewayAuthorizationHeaders } from "@/lib/client-session";
import {AGENT_TOOLS} from './agent-tool-catalog';

/** Tools the model may call. Reads run immediately; writes wait for the user's confirmation. */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type FileResult = {
  repository: string;
  branch: string;
  connection_version: number;
  path: string;
  sha: string;
  content: string;
};

export const CHAT_TOOLS = [
  ...AGENT_TOOLS,
  { type: "function", function: { name: "github_list_files", description: "List files in the connected GitHub repository.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "github_read_file", description: "Read one file from the connected GitHub repository.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },
  { type: "function", function: { name: "github_propose_commit", description: "Commit new content for one existing file to a new branch and open a draft pull request. The user must confirm before it runs. Read the file first and pass the full new content.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, title: { type: "string" } }, required: ["path", "content", "title"], additionalProperties: false } } },
  { type: "function", function: { name: "vercel_list_deployments", description: "List recent Vercel deployments for the selected project.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "supabase_project", description: "Read the selected Supabase project summary.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "railway_project", description: "Read the selected Railway project summary.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "n8n_project", description: "Read the selected n8n workflow summary.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
] as const;

export type WriteProposal = {
  id: string;
  summary: string;
  change?: { repository: string; branch: string; connection_version: number; path: string; sha: string; content: string; title: string; operation: string };
  agent_review?: {target:'crm'|'brain'|'mail';id:string};
};

export type CanvasItem = { title: string; content: string;kind?:'markdown'|'image' };
export type ToolOutcome = { content: string; failed?:boolean; data?:unknown; proposal?: WriteProposal; canvas?: CanvasItem };

/** Wraps file text in a fence longer than any backtick run inside it, so it renders as code. */
function codeBlock(text: string, language: string) {
  const fence = "`".repeat(Math.max(3, (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length + 1), 3)));
  return `${fence}${language}\n${text}\n${fence}`;
}

function languageFor(path: string) {
  return path.split(".").pop()?.replace(/[^a-z0-9]/gi, "") ?? "";
}

const READS:Record<string,string>={vercel_list_deployments:'vercel/deployments',supabase_project:'supabase/project',railway_project:'railway/project',n8n_project:'n8n/project'};

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}");
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}

/** Runs one tool call. Reads return data; a write returns a proposal that needs confirmation. */
export async function runToolCall(call: ToolCall,context:Record<string,unknown>={},access?:TaskAccessClient): Promise<ToolOutcome> {
  const args = parseArgs(call.function.arguments);
  const name = call.function.name;
  try {
    if(AGENT_TOOLS.some(t=>t.function.name===name))return await agentToolRequest(name,args,context,undefined,access);
    if(!access)throw Error('Start a task with app permission before using a connected product.');
    if (name === "github_read_file") {
      const path = String(args.path ?? "");
      if (!path || path.includes("..")) return { failed:true, content: "Invalid file path." };
      // The connection already caps files at 300 KB, so the full content is kept: a rewrite must not drop lines.
      const file = await connectionRequest<FileResult>(`github/file?path=${encodeURIComponent(path)}`,"GET",undefined,access?{id:access.id,fetch:access.fetch.bind(access)}:undefined);
      return {
        content: JSON.stringify({ repository: file.repository, path: file.path, branch: file.branch, content: file.content }),
        canvas: { title: file.path, content: `${file.repository} · ${file.branch}\n\n${codeBlock(file.content, languageFor(file.path))}` },
      };
    }
    if (name === "github_propose_commit") {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const title = String(args.title ?? "").trim();
      if (!path || !content || !title) return { failed:true, content: "Commit needs a path, content, and title." };
      const file = await connectionRequest<FileResult>(`github/file?path=${encodeURIComponent(path)}`,"GET",undefined,access?{id:access.id,fetch:access.fetch.bind(access)}:undefined);
      const operation = crypto.randomUUID();
      return {
        content: "Waiting for the user to confirm this commit and pull request. Do not claim it was made.",
        canvas: { title: `Proposed: ${file.path}`, content: `${file.repository} · ${file.branch} → new branch\n\n${title}\n\n${codeBlock(content, languageFor(file.path))}` },
        proposal: {
          id: operation,
          summary: `${file.repository} · ${file.path}\n${title}`,
          change: { repository: file.repository, branch: file.branch, connection_version: file.connection_version, path: file.path, sha: file.sha, content, title, operation },
        },
      };
    }
    if (name === "github_list_files") {
      const tree = await connectionRequest<{ repository: string; branch: string; files: { path: string }[] }>("github/tree","GET",undefined,access?{id:access.id,fetch:access.fetch.bind(access)}:undefined);
      return {
        content: JSON.stringify(tree).slice(0, 60000),
        canvas: { title: "Repository files", content: `${tree.repository} · ${tree.branch}\n\n${tree.files.map((file) => `- ${file.path}`).join("\n")}` },
      };
    }
    const read = READS[name];
    if (read) {return {content:JSON.stringify(await connectionRequest(read,"GET",undefined,access?{id:access.id,fetch:access.fetch.bind(access)}:undefined)).slice(0,60000)};}
    return { failed:true, content: `Unknown tool ${name}.` };
  } catch (cause) {
    return { failed:true,content: `Tool ${name} failed: ${cause instanceof Error ? cause.message : "unknown error"}. Tell the user; do not guess the result.` };
  }
}

export async function createPullRequest(change: NonNullable<WriteProposal["change"]>,access?:TaskAccessClient): Promise<string> {
  if(!access)throw Error('Task access is required before creating a pull request.');
  const result = await connectionRequest<{ url: string }>("github/pull-request", "POST", change,access?{id:access.id,fetch:access.fetch.bind(access)}:undefined);
  return `Draft pull request created: ${result.url}. Review it before merging.`;
}

export async function agentToolRequest(name:string,args:Record<string,unknown>,context:Record<string,unknown>,confirm?:WriteProposal['agent_review'],access?:TaskAccessClient):Promise<ToolOutcome>{
 const response=await (access?access.fetch.bind(access):fetch)('/api/agent/tools',{method:'POST',headers:{'Content-Type':'application/json',...await gatewayAuthorizationHeaders()},body:JSON.stringify({name,args,...(access?{task_id:access.id}:{}),...(context.conversation_id?{conversation_id:context.conversation_id}:{}),...(context.crm_scope?{crm_scope:context.crm_scope}:{}),...(confirm?{confirm}:{})}),cache:'no-store'});
 const result=await response.json();if(!response.ok)throw Error(result.error||'The connected action could not complete.');return result;
}


export type GatewayMessage = { role: string; content?: unknown; tool_calls?: ToolCall[]; tool_call_id?: string };

/** FastAPI validation errors put the reason in a list of { msg } objects. */
function errorText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => (typeof item?.msg === "string" ? item.msg : JSON.stringify(item))).join("; ");
  return "";
}

/** Runs a model turn, executing read tools and waiting for confirmation before any write. */
export async function runAgentTurn(
  messages: GatewayMessage[],
  model: string,
  extraBody: Record<string, unknown>,
  confirmWrite: (proposal: WriteProposal) => Promise<boolean>,
  onStatus: (status: string) => void,
  onCanvas: (item: CanvasItem) => void,
  access?:TaskAccessClient,
  observer?:TaskObserver,
): Promise<string> {
  const convo = [...messages];
  for (let step = 0; step < 6; step += 1) {
    if(observer?.cancelled())throw Error('Pending task work was stopped.');
    const response = await (access?access.fetch.bind(access):fetch)("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...await gatewayAuthorizationHeaders() },
      body: JSON.stringify({ ...extraBody,...(access?{task_id:access.id}:{}), model, messages: convo, tools: CHAT_TOOLS, stream: false }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorText(data.detail) || errorText(data.error) || `Request failed (${response.status}).`);
    const message = data.choices?.[0]?.message ?? {};
    const calls: ToolCall[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) return typeof message.content === "string" ? message.content : "";
    convo.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
    for (const call of calls) {
      if(observer?.cancelled())throw Error('Pending task work was stopped.');
      const progressId=`tool-${step}-${call.id}`;const presentation=toolPresentation(call.function.name);observer?.event({type:'step',id:progressId,...presentation});
      onStatus(presentation.title+"…");
      const outcome = await runToolCall(call,extraBody,access);
      if (outcome.canvas) onCanvas(outcome.canvas);
      let content = outcome.content;
      if(observer?.cancelled()){observer.event({type:'result',id:progressId,state:outcome.failed?'failed':'completed',detail:content});throw Error('Pending task work was stopped.');}
      if (outcome.proposal) {
        onStatus("Waiting for your confirmation…");
        observer?.event({type:'review',id:progressId,detail:outcome.proposal.summary});
        const approved = await confirmWrite(outcome.proposal);
        if(observer?.cancelled())throw Error('Pending task work was stopped.');
        if(approved)observer?.event({type:'step',id:progressId,...presentation});
        if(!approved)content='The user declined this action. Do not run it.';
        else if(outcome.proposal.agent_review)content=(await agentToolRequest('confirm',{},extraBody,outcome.proposal.agent_review,access)).content;
        else if(outcome.proposal.change)content=await createPullRequest(outcome.proposal.change,access);
        else throw Error('This proposal has no executable review. Request a new proposal.');
      }
      observer?.event({type:'result',id:progressId,state:outcome.failed?'failed':outcome.proposal&&content.includes('user declined')?'skipped':'completed',detail:content});
      convo.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  observer?.event({type:'fail',detail:'Stopped after too many tool steps. Narrow the request before starting again.'});
  return "Stopped after too many tool steps. Ask again with a narrower request.";
}
