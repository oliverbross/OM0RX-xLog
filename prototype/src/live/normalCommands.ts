import type {KeyboardEvent as ReactKeyboardEvent} from "react";
/** One application-scoped normal command vocabulary. Native/CW/contest fixed keys stay reserved. */
export const normalActions = [
  {id:"focus-callsign",label:"Focus callsign",context:"Live QSO editor",defaultBinding:""},
  {id:"save-current-qso",label:"Save current QSO",context:"Live QSO editor",defaultBinding:"Primary+Enter"},
  {id:"accept-nearby-callsign",label:"Accept nearby spotted callsign",context:"Live QSO editor · one candidate",defaultBinding:""},
  {id:"open-logbook",label:"Open Logbook",context:"Normal Logging",defaultBinding:""},
  {id:"open-world-map",label:"Open World Map",context:"Normal Logging",defaultBinding:""},
  {id:"open-band-maps",label:"Open Band Maps",context:"Normal Logging",defaultBinding:""},
  {id:"open-alerts",label:"Open Alerts",context:"Normal Logging",defaultBinding:""},
  {id:"open-awards",label:"Open Awards",context:"Normal Logging",defaultBinding:""},
  {id:"open-cw-workbench",label:"Open CW workbench",context:"Normal Logging",defaultBinding:""},
  {id:"cw-compose-preview",label:"Preview CW composition",context:"CW workbench",defaultBinding:""},
  {id:"cw-compose-send",label:"Send CW composition",context:"Focused CW workbench · armed",defaultBinding:""},
] as const;
export type NormalAction = typeof normalActions[number]["id"];
export type NormalBindings = {version:1;overrides:Record<string,string>};
export const defaultNormalBindings = ():NormalBindings=>({version:1,overrides:{}});
export type KeyInput = Pick<KeyboardEvent,"key"|"code"|"ctrlKey"|"metaKey"|"altKey"|"shiftKey"|"repeat"|"isComposing"|"getModifierState">;
export function chordForEvent(event:KeyInput,mac = /Mac|iPhone|iPad/.test(navigator.platform)):string|null{
  if(event.isComposing || event.key==="Dead" || event.key==="Process" || event.key==="Unidentified" || event.getModifierState?.("AltGraph") || event.ctrlKey&&event.altKey) return null;
  const primary=mac?event.metaKey:event.ctrlKey;
  if(!primary || mac&&event.ctrlKey || !mac&&event.metaKey)return null;
  const key=event.key.length===1?event.key.toUpperCase():event.key;
  if(!/^[A-Z0-9]$/.test(key)&&key!=="Enter")return null;
  return ["Primary",...(event.altKey?["Alt"]:[]),...(event.shiftKey?["Shift"]:[]),key].join("+");
}
export function normalizeChord(value:string):string|null {
  if(value==="")return "";
  const parts=value.replace(/Command|Cmd|Control|Ctrl|Meta/g,"Primary").split("+");
  if(parts[0]!=="Primary" || new Set(parts).size!==parts.length)return null;
  const key=parts.pop()!;
  const canonical=["Primary",...(parts.includes("Alt")?["Alt"]:[]),...(parts.includes("Shift")?["Shift"]:[]),key.length===1?key.toUpperCase():key].join("+");
  return parts.every(part=>["Primary","Alt","Shift"].includes(part)) && (/^[A-Za-z0-9]$/.test(key)||key==="Enter") ? canonical:null;
}
const native = new Set(["Primary+1","Primary+2","Primary+3","Primary+4","Primary+L","Primary+Shift+K","Primary+Shift+S","Primary+Shift+R"]);
const editing = new Set(["Primary+A","Primary+C","Primary+V","Primary+X","Primary+Z","Primary+Shift+Z","Primary+Y","Primary+Q","Primary+W","Primary+M","Primary+H","Primary+N","Primary+O","Primary+P","Primary+F","Primary+S","Primary+R","Primary+T","Primary+I","Primary+J","Primary+K"]);
export const bindingFor=(id:NormalAction,bindings:NormalBindings)=>bindings.overrides[id]??normalActions.find(action=>action.id===id)!.defaultBinding;
export function bindingConflict(id:NormalAction,chord:string,bindings:NormalBindings):string|null{
  const normalized=normalizeChord(chord);
  if(normalized===null || normalized!==chord)return "Use Command/Ctrl with a letter, number or Enter; AltGr, dead keys and function keys are unavailable.";
  if(!chord)return null;
  if(chord.includes("+Alt+"))return "Primary + Alt is reserved for keyboard layout and AltGr input; use Primary + Shift instead.";
  if(native.has(chord))return "Reserved by an existing native navigation, CW or radio command.";
  if(editing.has(chord))return "Reserved for native lifecycle or ordinary text editing.";
  if(chord==="Primary+Enter"&&id!=="save-current-qso")return "Reserved for Save current QSO.";
  const other=normalActions.find(action=>action.id!==id&&bindingFor(action.id,bindings)===chord);
  return other?`Already assigned to ${other.label} in the overlapping Normal Logging context.`:null;
}
export function checkedBindings(value:unknown):{bindings:NormalBindings;warnings:string[]}{
  const warnings:string[]=[];
  if(!value)return {bindings:defaultNormalBindings(),warnings};
  const candidate=value as NormalBindings;
  if(!candidate.overrides||typeof candidate.overrides!=="object"||Array.isArray(candidate.overrides)||Object.keys(candidate.overrides).length>64)
    return {bindings:defaultNormalBindings(),warnings:["Saved shortcuts are invalid; known defaults are active."]};
  const preserved=Object.fromEntries(Object.entries(candidate.overrides).filter(([id,chord])=>/^[a-z0-9-]{1,64}$/.test(id)&&typeof chord==="string"&&chord.length<=64&&!/[\x00-\x1f\x7f]/.test(chord)));
  if(candidate.version!==1)return {bindings:{version:1,overrides:Object.fromEntries(Object.entries(preserved).filter(([id])=>!normalActions.some(action=>action.id===id)))},
    warnings:["This shortcut document version is unavailable; known defaults are active and unavailable actions are preserved."]};
  const bindings:NormalBindings={version:1,overrides:preserved};
  for(const action of normalActions){
    const chord=bindings.overrides[action.id];
    if(chord!==undefined && (typeof chord!=="string"||bindingConflict(action.id,chord,bindings))){
      delete bindings.overrides[action.id];warnings.push(`${action.label}: invalid saved binding; default active.`);
    }
  }
  return {bindings,warnings};
}
export function actionForEvent(event:KeyInput,bindings:NormalBindings,mac?:boolean):NormalAction|null{
  if(event.repeat)return null;
  const chord=chordForEvent(event,mac);
  return chord?normalActions.find(action=>bindingFor(action.id,bindings)===chord)?.id??null:null;
}
export const displayChord=(chord:string,mac=/Mac|iPhone|iPad/.test(navigator.platform))=>chord?chord.replace("Primary",mac?"⌘":"Ctrl").replaceAll("+"," + "):"Unassigned";
// Only editor handlers consume Save/focus; the navigation dispatcher ignores them.
let currentBindings=defaultNormalBindings();
export type NormalBindingContext={generation:string;revision:number};
let bindingContext:NormalBindingContext|null=null;
export const selectNormalBindingScope=(generation?:string)=>{
  if(bindingContext?.generation===generation)return;
  currentBindings=defaultNormalBindings();bindingContext=generation?{generation,revision:-1}:null;
};
export const normalBindingContext=()=>bindingContext;
export const setNormalBindings=(value:unknown,context?:NormalBindingContext)=>{
  if(context){
    if(!context.generation||!Number.isSafeInteger(context.revision)||context.revision<0)return false;
    if(bindingContext&&(bindingContext.generation!==context.generation||bindingContext.revision>context.revision))return false;
  }
  currentBindings=checkedBindings(value).bindings;bindingContext=context??null;return true;
};
export const currentNormalBindings=()=>currentBindings;
export function editorCommand(event:KeyboardEvent|ReactKeyboardEvent,handlers:{save:()=>void;focus:()=>void}):boolean{
  const native="nativeEvent" in event?event.nativeEvent:event;
  if(event.defaultPrevented||document.documentElement.dataset.shortcutCapture==="true")return false;
  if(native.repeat && normalActions.some(action=>bindingFor(action.id,currentBindings)===chordForEvent(native))) {event.preventDefault();event.stopPropagation();return true;}
  const action=actionForEvent(native,currentBindings);
  if(action!=="save-current-qso"&&action!=="focus-callsign")return false;
  event.preventDefault();event.stopPropagation();if(action==="save-current-qso")handlers.save();else handlers.focus();return true;
}

export const commandTitle=(id:NormalAction)=>`${normalActions.find(action=>action.id===id)!.label} · ${displayChord(bindingFor(id,currentBindings))}`;
