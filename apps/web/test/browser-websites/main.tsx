import React from 'react';
import {createRoot} from 'react-dom/client';
import WebsiteEditor from '../../components/website-editor';
import PlanPackages from '../../components/plan-packages';
const plans=new URLSearchParams(location.search).has('plans');
createRoot(document.getElementById('root')!).render(plans?<div style={{padding:32,background:'#05090c',color:'#eee',minHeight:'100vh'}}><PlanPackages/></div>:<WebsiteEditor/>);
