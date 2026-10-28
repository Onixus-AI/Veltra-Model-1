'use client';
import dynamic from 'next/dynamic';
const WebsiteEditor=dynamic(()=>import('@/components/website-editor'),{ssr:false,loading:()=><main style={{padding:40}}><h1>Website builder</h1><p role="status">Loading editor…</p></main>});
export default function WebsitesPage(){return <WebsiteEditor/>;}
