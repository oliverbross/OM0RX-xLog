import { useEffect, useState } from "react";
import type { ReferenceEvidence } from "./QSOHeader";
type Data = Record<string, any>;
/** Verification is display-only. Never copy response.fields into an editor. */
export function useReferenceEvidence(draft: Data | null, generation: string | undefined,
  request: (method: string, params: Data) => Promise<any>, revision = 0) {
  const [result, setResult] = useState<{ key: string; evidence: ReferenceEvidence } | null>(null);
  const call = String(draft?.call ?? "").trim().toUpperCase();
  const tags = [["POTA", draft?.potaReference], ["SOTA", draft?.sotaReference], ["IOTA", draft?.iota],
    ["WWFF", draft?.wwffReference], [draft?.sig || "WCA", draft?.sigInfo]].filter(([, value]) => typeof value === "string" && value.trim()).map(([kind, value]) => `${kind}:${value}`);
  const comment = String(draft?.comment ?? "");
  const key = JSON.stringify([generation, draft?.id, call, comment, tags]);
  useEffect(() => {
    setResult(null);
    if (!generation || !call || !tags.length && !comment.trim()) return;
    let active = true;
    const timer = setTimeout(() => {
      void request("reference_resolve", { comment, special_tags: tags }).then(result => {
        if (!active) return;
        if (!Array.isArray(result?.references)) throw new Error("Reference response unavailable");
        setResult({ key, evidence: { call, rows: result.references } });
      }).catch(() => { if (active) setResult({ key, evidence: { call, rows: [], error: "Reference verification unavailable. Entered references are unchanged." } }); });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [key, request, revision]);
  return result?.key === key ? result.evidence : null;
}
