/** Supported actions, not connection state or permission to execute a write. */
export const ONYX_ACTION_CAPABILITIES = {
  mail:{tools:['mail_send','mail_trash'],review_required:true,sending:'One plain-text email with exact recipient, subject and body',deletion:'Recoverable Trash for selected returned messages only',permanent_deletion:false,receipt:'Provider acceptance is not delivery; uncertain sends must not be retried automatically'},
  research:{tool:'web_search',reads:['up to five public HTTPS search results'],configured:'Check tool response',daily_limit:20},
  importing:{tool:'crm_bulk_import',review_required:true,batch_limit:500,policy:'Business contacts only; skip existing company/email matches; no sending or consent inference'},
  memory: {tool:'brain_change',actions:['propose','approve','correct','forget'],approval_arguments:['action','id'],review_required:true},
  development: {tool:'github_develop',actions:['status','propose','release','verify_release'],policy:'Read live status before publishing; proposal and release require separate human reviews.',testing:'Existing repository CI; no arbitrary shell or model-weight training.'},
};

function toolNames(tools:unknown):Set<string>{
  return new Set(Array.isArray(tools)?tools.flatMap(t=>typeof t?.function?.name==='string'?[t.function.name]:[]):[]);
}

export function toolSessionError(tools:unknown):string|null{
  const names=toolNames(tools);
  if(!names.has('github_develop')&&['github_review_proposal','github_propose_commit','github_propose_changes'].some(n=>names.has(n)))
    return 'This Workspace tab has an outdated Onyx tool catalog. Refresh Workspace before continuing development. No action was executed by this request.';
  return null;
}

export function toolSessionReference(tools:unknown):string{
  const names=toolNames(tools);
  return '\nCurrent host capability contract (takes precedence over older assistant statements or saved procedures about available tools): '+JSON.stringify({
    signal:names.has('signal_creative')?{tool:'signal_creative',reads:['context','library','result'],reviewed_writes:['one still-image draft'],publishing:false,autopilot_handoff:'Only when the reviewed Signal proposal explicitly includes it; Signal quality control and scheduler own review and publication. Read live context and result receipts.',vision:false}:'Signal tool not advertised in this session; request Signal creative tools in a refreshed Workspace chat.',
    mail:names.has('mail_send')&&names.has('mail_trash')?ONYX_ACTION_CAPABILITIES.mail:'Reviewed Mail actions are not advertised in this client. Refresh Workspace.',
    memory:names.has('brain_change')?ONYX_ACTION_CAPABILITIES.memory:'No memory tool advertised by this client.',
    development:names.has('github_develop')?ONYX_ACTION_CAPABILITIES.development:'No development tool advertised by this client.',
    rule:'Use the advertised tool and read its result before declaring an action unavailable. Memory approve uses action and id only; content/source_ref are required for propose/correct. Never infer publishing is paused from conversation history. Capabilities are not authorization, live policy, or completion receipts.',
  });
}
