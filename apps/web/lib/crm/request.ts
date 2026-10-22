/** Bound UI waiting even if session acquisition stalls before fetch begins. */
export function crmDeadline<T>(request:PromiseLike<T>,signal?:AbortSignal,milliseconds=20000):Promise<T>{
 return new Promise((resolve,reject)=>{
  const fail=()=>{cleanup();reject(Error('CRM request did not finish. Refresh and check the record before retrying a change.'));};
  const timer=setTimeout(fail,milliseconds);
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',fail);};
  if(signal?.aborted){cleanup();fail();return;}signal?.addEventListener('abort',fail,{once:true});
  Promise.resolve(request).then(resolve,reject).finally(cleanup);
 });
}
