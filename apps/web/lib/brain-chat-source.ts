import type {SupabaseClient} from '@supabase/supabase-js';
import type {BrainScope} from './shared-brain';
export type ChatMemorySeed={content:string;index:number;revision:number};
/** Resolve provenance from an owned saved conversation, never a browser-supplied source label. */
export async function chatMemorySource(client:SupabaseClient,user:string,scope:BrainScope,body:Record<string,unknown>){
 if(typeof body.conversation_id!=='string'||!Number.isSafeInteger(body.source_index)||Number(body.source_index)<0||!Number.isSafeInteger(body.source_revision))throw Error('400:Choose a saved Chat message.');
 const {data:row,error}=await client.from('crm_conversations').select('revision,messages,workspace_id,customer_id').eq('id',body.conversation_id).eq('user_id',user).maybeSingle();
 if(error)throw error;
 if(!row)throw Error('404:Source conversation is unavailable.');
 if(row.revision!==body.source_revision||(row.workspace_id??null)!==(scope.workspace_id??null)||(row.customer_id??null)!==(scope.customer_id??null))throw Error('409:Source changed. Reopen the saved conversation and select the message again.');
 const message=Array.isArray(row.messages)?row.messages[Number(body.source_index)]:null;
 if(!message||!['user','assistant'].includes(message.role)||typeof message.content!=='string'||!message.content.trim())throw Error('400:Choose a saved text message.');
 if(typeof body.source_excerpt!=='string'||body.source_excerpt!==message.content.slice(0,4000))throw Error('409:The selected text is not the saved message. Refresh the conversation before saving a memory.');
 return `Chat conversation ${body.conversation_id} · revision ${row.revision} · message ${Number(body.source_index)+1} · ${message.role}`;
}
export async function checkChatMemoryDuplicate(client:SupabaseClient,user:string,scope:BrainScope,content:string,source:string){
 const lookup=async(field:string,value:string)=>{
 let query=client.from('veltra_memories').select('id').eq(field,value);
 query=scope.workspace_id?query.eq('workspace_id',scope.workspace_id):query.is('workspace_id',null).eq('user_id',user);
 query=scope.customer_id?query.eq('customer_id',scope.customer_id):query.is('customer_id',null);
 const {data,error}=await query.limit(1);if(error)throw error;return Boolean(data?.length);
 };
 if((await Promise.all([lookup('content',content),lookup('source_ref',source)])).some(Boolean))throw Error('409:A memory with this text or source already exists in this scope. Search shared brain before adding it again.');
}
