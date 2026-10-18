'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
type Recognition={lang:string;continuous:boolean;interimResults:boolean;onresult:((event:{resultIndex:number;results:{length:number;[index:number]:{isFinal:boolean;[index:number]:{transcript:string}}}})=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;onstart:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export default function VoiceInput({disabled,onTranscript}:{disabled:boolean;onTranscript:(text:string)=>void}){
 const [supported,setSupported]=useState<boolean|null>(null),[listening,setListening]=useState(false),[message,setMessage]=useState('');
 const recognition=useRef<Recognition|null>(null),receive=useRef(onTranscript);receive.current=onTranscript;
 useEffect(()=>{const w=window as SpeechWindow;setSupported(Boolean(w.SpeechRecognition||w.webkitSpeechRecognition));return()=>{const r=recognition.current;if(r){r.onresult=null;r.onerror=null;r.onend=null;r.onstart=null;r.abort();}};},[]);
 useEffect(()=>{if(disabled)recognition.current?.stop();},[disabled]);
 function toggle(){
  if(recognition.current){recognition.current.stop();return;}
  const w=window as SpeechWindow,Constructor=w.SpeechRecognition||w.webkitSpeechRecognition;
  if(!Constructor){setMessage('Voice input is unavailable in this browser. Try Chrome or Safari.');return;}
  const r=new Constructor();recognition.current=r;r.lang=navigator.language||'en-US';r.continuous=false;r.interimResults=false;
  r.onstart=()=>{setListening(true);setMessage('Listening… Your words will be added to the draft.');};
  r.onresult=event=>{let text='';for(let i=event.resultIndex;i<event.results.length;i++)if(event.results[i].isFinal)text+=event.results[i][0].transcript+' ';if(text.trim())receive.current(text.trim());};
  r.onerror=event=>setMessage(event.error==='not-allowed'?'Microphone access was denied. Allow it in your browser to use voice input.':event.error==='no-speech'?'No speech detected. Try again.':event.error==='audio-capture'?'No microphone is available.':'Voice input could not finish. Try again or type your message.');
  r.onend=()=>{recognition.current=null;setListening(false);setMessage(old=>old.startsWith('Listening')?'Voice input stopped. Review your draft before sending.':old);};
  setMessage('Starting voice input…');try{r.start();}catch{recognition.current=null;setListening(false);setMessage('Voice input could not start. Check your microphone permissions.');}
 }
 return <div className="voice-input"><button type="button" className={`composer-tool ${listening?'is-listening':''}`} disabled={disabled||supported===null} aria-label={listening?'Stop voice input':'Start voice input'} aria-pressed={listening} aria-describedby="voice-help" onClick={toggle}>{listening?<Square size={15}/>:<Mic size={17}/>}</button><span id="voice-help" className="voice-help" role="status">{message||'Voice input uses your browser’s speech service. Review text before sending.'}</span></div>;
}
