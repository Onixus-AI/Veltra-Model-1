import {browserSupabase} from '@/lib/supabase';
import {readSnapshot} from './snapshot';
export const db=browserSupabase();
export async function snapshot(workspace:string,signal?:AbortSignal){
 if(!db)throw Error('Connect a Veltra Supabase project first.');
 return readSnapshot(db,workspace,signal);
}
