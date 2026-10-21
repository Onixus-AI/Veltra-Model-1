'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {chatPreview} from '@/lib/chat-preview';
export default function ChatResponse({content}:{content:string}){
 const result=chatPreview(content);
 return <div className="chat-response-container">{result.long?<><p className="chat-response-summary">{result.preview}</p><details className="chat-response-details"><summary>Details · read full response</summary><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></details></>:<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>}</div>;
}
