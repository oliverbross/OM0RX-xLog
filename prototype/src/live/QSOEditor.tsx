import QSOEditorCore, { type QSOEditorProps } from "./QSOEditorCore";
import QSOEditorCanvas from "./QSOEditorCanvas";

export { draftPowerDescription, safeProfileURL } from "./QSOEditorCore";
export type { QSOEditorProps } from "./QSOEditorCore";

export function QSOEditor(props: QSOEditorProps) {
  return <QSOEditorCore {...props} canvas={QSOEditorCanvas} />;
}

export default QSOEditor;
