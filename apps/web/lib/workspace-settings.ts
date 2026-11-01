import {readWorkspacePreferences,type WorkspacePreferences} from './workspace-navigation';
import {readAppearance,type Appearance} from './workspace-appearance';

// Preferences only: these fields must never participate in authorization.
export const preferenceKeys={layout:'onixus_workspace_layout_v1',appearance:'onixus_workspace_appearance_v1'} as const;
export type WorkspaceSettings={layout:WorkspacePreferences;appearance:Appearance};
export type PreferenceSection=keyof WorkspaceSettings;
export type AccountSettings=WorkspaceSettings&{userId:string;hasLayout:boolean;hasAppearance:boolean};
export function defaultSettings():WorkspaceSettings{return {layout:readWorkspacePreferences(null),appearance:readAppearance(null)};}
export function accountSettings(user:{id:string;user_metadata?:Record<string,unknown>}):AccountSettings{
 const data=user.user_metadata??{};
 return {userId:user.id,layout:readWorkspacePreferences(data[preferenceKeys.layout]),appearance:readAppearance(data[preferenceKeys.appearance]),hasLayout:validVersion(data[preferenceKeys.layout]),hasAppearance:validVersion(data[preferenceKeys.appearance])};
}
export function validVersion(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&(value as {version?:unknown}).version===1;}
export function normalizePreference(section:'layout',value:unknown):WorkspacePreferences;
export function normalizePreference(section:'appearance',value:unknown):Appearance;
export function normalizePreference(section:PreferenceSection,value:unknown):WorkspacePreferences|Appearance;
export function normalizePreference(section:PreferenceSection,value:unknown){return section==='layout'?readWorkspacePreferences(value):readAppearance(value);}
