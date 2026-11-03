import {useState} from "react";
import {normalActions,bindingFor,currentNormalBindings,displayChord} from "./normalCommands";
export function NormalShortcutHelp(){
  const [,refresh]=useState(0);
  return <details className="normal-shortcut-help" onToggle={event=>{if(event.currentTarget.open)refresh(value=>value+1);}}>
    <summary>Shortcuts</summary><div><strong>Normal Logging shortcuts</strong><dl>{normalActions.map(action=><div key={action.id}><dt>{action.label}</dt><dd>{displayChord(bindingFor(action.id,currentNormalBindings()))} · {action.context}</dd></div>)}</dl>
    <p>Edit in Settings → Display. Native Command/Ctrl + 1–4 and L stay fixed. Escape/Stop, CW and contest bindings retain their existing contexts.</p></div>
  </details>;
}
