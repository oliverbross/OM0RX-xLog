import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ContestSetupPanel } from "./ContestSetupPanel";
import { closeContestSetupDialog, saveContestSetupDialog, setupDialogRequest, type SetupDialogSnapshot } from "./contestSetupDialogs";
import { openContestSetupService } from "./contestSetupServices";
import "./ContestWorkspace.css";
import "./DetachedContestSetupDialog.css";

export function fittedConfigurationDialogHeight(contentHeight: number): number {
  return Math.max(320, Math.min(900, Math.ceil(contentHeight)));
}

export function isManagedConfigurationDialogHeight(height: number): boolean {
  return [320, 520, 620].some(managed => Math.abs(height - managed) < 0.5);
}

type DialogSize = { width: number; height: number };
const sameDialogSize = (a: DialogSize, b: DialogSize) => Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

export function DetachedContestSetupDialog() {
  const kind = new URLSearchParams(window.location.search).get("view") === "contest-setup-station" ? "station" : "configuration";
  const [snapshot, setSnapshot] = useState<SetupDialogSnapshot | null>(null), [error, setError] = useState("");
  const shell = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true, retry: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await setupDialogRequest<SetupDialogSnapshot>("snapshot");
        if (active) { setSnapshot(value); setError(""); }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Contest Setup is unavailable.");
          retry = setTimeout(() => void load(), 250);
        }
      }
    };
    void load();
    return () => { active = false; clearTimeout(retry); };
  }, []);
  useEffect(() => {
    if (kind !== "configuration" || !snapshot || !isTauri()) return;
    let active = true, autoFit = false, frame = 0, scale = 1, acceptedSize: DialogSize | null = null, pendingFit = false;
    let inFlight: { target: DialogSize } | null = null, restoreInFlight: { target: DialogSize; generation: number } | null = null;
    let operatorSize: DialogSize | null = null, operatorGeneration = 0, restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const programmaticTargets: DialogSize[] = [];
    let observer: ResizeObserver | undefined, stopResize: (() => void) | undefined;
    const nativeWindow = getCurrentWindow();
    const rememberProgrammaticTarget = (size: DialogSize) => {
      if (!programmaticTargets.some(target => sameDialogSize(target, size))) programmaticTargets.push(size);
    };
    const scheduleOperatorRestore = () => {
      clearTimeout(restoreTimer);
      if (!active || !operatorSize) return;
      const generation = operatorGeneration;
      restoreTimer = setTimeout(() => void restoreOperatorSize(generation), 120);
    };
    const restoreOperatorSize = async (generation: number) => {
      const desired = operatorSize;
      if (!active || !desired || generation !== operatorGeneration) return;
      if (inFlight || restoreInFlight) { scheduleOperatorRestore(); return; }
      try {
        const currentScale = await nativeWindow.scaleFactor();
        const current = (await nativeWindow.innerSize()).toLogical(currentScale);
        if (!active || generation !== operatorGeneration || !operatorSize) return;
        if (sameDialogSize(current, operatorSize)) { acceptedSize = operatorSize; return; }
        const restoration = { target: { ...operatorSize }, generation };
        restoreInFlight = restoration;
        rememberProgrammaticTarget(restoration.target);
        await nativeWindow.setSize(new LogicalSize(restoration.target.width, restoration.target.height));
        if (!active || restoreInFlight !== restoration) return;
        const appliedScale = await nativeWindow.scaleFactor();
        const applied = (await nativeWindow.innerSize()).toLogical(appliedScale);
        if (sameDialogSize(applied, restoration.target)) observedResize(applied);
        else { restoreInFlight = null; scheduleOperatorRestore(); }
      } catch {
        if (restoreInFlight?.generation === generation) restoreInFlight = null;
      }
    };
    const observedResize = (size: DialogSize) => {
      const transaction = inFlight;
      if (transaction && sameDialogSize(size, transaction.target)) {
        inFlight = null;
        acceptedSize = size;
        if (operatorSize) { scheduleOperatorRestore(); return; }
        if (autoFit && pendingFit) { pendingFit = false; fit(); }
        return;
      }
      const restoration = restoreInFlight;
      if (restoration && sameDialogSize(size, restoration.target)) {
        restoreInFlight = null;
        acceptedSize = size;
        if (operatorSize && !sameDialogSize(size, operatorSize)) scheduleOperatorRestore();
        return;
      }
      if (programmaticTargets.some(target => sameDialogSize(target, size))) {
        acceptedSize = size;
        if (operatorSize && !sameDialogSize(size, operatorSize)) scheduleOperatorRestore();
        return;
      }
      if (acceptedSize && sameDialogSize(size, acceptedSize)) return;
      operatorSize = size;
      operatorGeneration += 1;
      acceptedSize = size;
      if (!autoFit) { scheduleOperatorRestore(); return; }
      autoFit = false;
      pendingFit = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      scheduleOperatorRestore();
    };
    const fit = () => {
      if (inFlight) { pendingFit = true; return; }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = shell.current;
        if (!active || !autoFit || !root) return;
        if (inFlight) { pendingFit = true; return; }
        const height = fittedConfigurationDialogHeight(root.scrollHeight);
        void Promise.all([nativeWindow.innerSize(), nativeWindow.scaleFactor()])
          .then(async ([size, scale]) => {
            if (!active || !autoFit || inFlight) { if (inFlight) pendingFit = true; return; }
            const logical = size.toLogical(scale);
            if (Math.abs(logical.height - height) < 0.5) return;
            const transaction = { target: { width: logical.width, height } };
            inFlight = transaction;
            rememberProgrammaticTarget(transaction.target);
            try {
              await nativeWindow.setSize(new LogicalSize(transaction.target.width, transaction.target.height));
              if (!active || inFlight !== transaction) return;
              const currentScale = await nativeWindow.scaleFactor();
              const current = (await nativeWindow.innerSize()).toLogical(currentScale);
              if (sameDialogSize(current, transaction.target)) { observedResize(current); return; }
              if (!autoFit && operatorSize) { inFlight = null; scheduleOperatorRestore(); }
            } catch {
              if (inFlight === transaction) inFlight = null;
            }
          })
          .catch(() => {});
      });
    };
    void Promise.all([nativeWindow.innerSize(), nativeWindow.scaleFactor()]).then(async ([size, initialScale]) => {
      scale = initialScale;
      const initial = size.toLogical(scale);
      if (!active || !isManagedConfigurationDialogHeight(initial.height)) return;
      autoFit = true;
      // Absorb a resize notification already queued by native geometry restore;
      // only a later size different from our current/requested size is user-owned.
      acceptedSize = { width: initial.width, height: initial.height };
      stopResize = await nativeWindow.onResized(({ payload }) => {
        if (active) observedResize(payload.toLogical(scale));
      });
      if (!active) { stopResize(); return; }
      observer = new ResizeObserver(fit);
      if (shell.current) {
        observer.observe(shell.current);
        const content = shell.current.firstElementChild;
        if (content instanceof HTMLElement) observer.observe(content);
      }
      fit();
    }).catch(() => {});
    return () => { active = false; clearTimeout(restoreTimer); cancelAnimationFrame(frame); observer?.disconnect(); stopResize?.(); };
  }, [kind, snapshot]);
  return <main ref={shell} className="contest-workspace contest-setup-dialog" data-dialog-kind={kind} aria-label={kind === "station" ? "Station Settings" : "Configuration Settings"}>
    {error && <><p role="alert">{error}</p><button type="button" onClick={() => void closeContestSetupDialog()}>Cancel</button></>}
    {snapshot ? <ContestSetupPanel value={snapshot.document} sessions={[]} catalog={[]} detachedDialog={kind}
      initialTab={kind === "station" ? "Station" : "Lookup"} onCancel={closeContestSetupDialog}
      onSave={async document => { await saveContestSetupDialog(snapshot, document); await closeContestSetupDialog(); }}
      onCreate={async () => { throw new Error("Create contests in Contest Setup."); }}
      onOpen={async () => { throw new Error("Choose contests in Contest Setup."); }} onOpenSettings={openContestSetupService}/>
      : !error && <p role="status">Loading settings…</p>}
  </main>;
}
