/** Bounded lexical retrieval. This does not claim semantic/vector search. */
const stopWords=new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our please should tell than that the their them there these they this those to us was we were what when where which who why will with would you your hi hello'.split(' '));
export function brainSearchTerms(query:string):string[]{
 return [...new Set((query.slice(0,4000).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)??[])
  .filter(term=>term.length>1&&term.length<=48&&!stopWords.has(term)))].slice(0,8);
}
export function brainQueryFromMessages(messages:unknown):string{
 if(!Array.isArray(messages))return '';
 for(let index=messages.length-1;index>=0;index--){
  const message=messages[index];if(!message||message.role!=='user')continue;
  const content=typeof message.content==='string'?message.content:Array.isArray(message.content)
   ?message.content.filter((part:unknown)=>part&&typeof part==='object'&&(part as {type?:unknown}).type==='text'&&typeof (part as {text?:unknown}).text==='string').map((part:{text:string})=>part.text).join(' '):'';
  return brainSearchTerms(content).join(' ').slice(0,200);
 }
 return '';
}
export function rankBrainMemories<T extends {content:string}>(records:T[],query:string):T[]{
 const terms=brainSearchTerms(query);if(!terms.length)return records;
 return records.map((record,index)=>{
  const text=record.content.normalize('NFKC').toLocaleLowerCase(),words=new Set(text.match(/[\p{L}\p{N}]+/gu)??[]);
  const score=terms.reduce((sum,term)=>sum+(words.has(term)?4:text.includes(term)?1:0),0);
  return {record,index,score};
 }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.record);
}
