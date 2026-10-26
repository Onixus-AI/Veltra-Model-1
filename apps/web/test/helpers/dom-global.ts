// react-dom decides at load time whether a DOM exists, so this must be imported before React.
import {JSDOM} from 'jsdom';

export const dom=new JSDOM('<!doctype html><body></body>',{pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true});
