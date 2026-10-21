import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ContestSetupPanel } from "./ContestSetupPanel";
import { closeContestSetupDialog, saveContestSetupDialog, setupDialogRequest, type SetupDialogSnapshot } from "./contestSetupDialogs";
import { openContestSetupService } from "./contestSetupServices";
import "./ContestWorkspace.css";
import "./DetachedContestSetupDialog.css";

type DialogSize = { width: number; height: number };
const CONFIGURATION_AUTO_FIT_SIZE_KEY = "xlog.contest.configuration.auto-fit-size.v1";

const configurationDialogCeiling = (availableHeight: number): number => {
  const usableHeight = Number.isFinite(availableHeight) && availableHeight > 0 ? availableHeight : 884;
  return Math.max(320, Math.min(900, Math.floor(usableHeight - 64)));
};

export function fittedConfigurationDialogHeight(contentHeight: number, availableHeight = screen.availHeight): number {
  return Math.max(320, Math.min(configurationDialogCeiling(availableHeight), Math.ceil(contentHeight)));
}

export function configurationDialogContentHeight(root: HTMLElement): number {
  const content = root.firstElementChild;
  const style = getComputedStyle(root);
  const inset = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
    .reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
  if (!(content instanceof HTMLElement)) return root.scrollHeight;
  const contentHeight = Math.max(content.scrollHeight, content.getBoundingClientRect().height);
  const scrollRegion = content.querySelector("fieldset");
  const visibleScrollRegionHeight = scrollRegion instanceof HTMLElement ? scrollRegion.getBoundingClientRect().height : 0;
  const concealedContentHeight = scrollRegion instanceof HTMLElement && visibleScrollRegionHeight > 0
    ? Math.max(0, scrollRegion.scrollHeight - visibleScrollRegionHeight) : 0;
  return Math.ceil(contentHeight + concealedContentHeight + inset);
}

export function isManagedConfigurationDialogHeight(height: number, availableHeight = screen.availHeight): boolean {
  return [320, 463, 476, 520, 620, 680, 900, configurationDialogCeiling(availableHeight)]
    .some(managed => Math.abs(height - managed) < 0.5);
}

const sameDialogSize = (a: DialogSize, b: DialogSize) => Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

export function DetachedContestSetupDialog() {
  const view = new URLSearchParams(window.location.search).get("view");
  const kind = view === "contest-setup-station" ? "station" : view === "contest-setup-macros" ? "macros" : view === "contest-setup-keys" ? "keys" : "configuration";
  const [snapshot, setSnapshot] = useState<SetupDialogSnapshot | null>(null), [error, setError] = useState("");
  const shell = useRef<HTMLElement>(null);
  const requestConfigurationFit = useRef<() => void>(() => {});
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
    let active = true, autoFit = false, frame = 0, acceptedSize: DialogSize | null = null, pendingFit = false;
    let inFlight: { target: DialogSize } | null = null, restoreInFlight: { target: DialogSize; generation: number } | null = null;
    let operatorSize: DialogSize | null = null, operatorGeneration = 0, restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const programmaticTargets: DialogSize[] = [];
    let observer: ResizeObserver | undefined, contentObserver: MutationObserver | undefined, stopResize: (() => void) | undefined;
    const nativeWindow = getCurrentWindow();
    const storedAutoFitSize = (() => {
      try {
        const parsed = JSON.parse(localStorage.getItem(CONFIGURATION_AUTO_FIT_SIZE_KEY) ?? "null") as Partial<DialogSize> | null;
        return parsed && Number.isFinite(parsed.width) && Number.isFinite(parsed.height)
          ? { width: Number(parsed.width), height: Number(parsed.height) }
          : null;
      } catch { return null; }
    })();
    const rememberAutoFitSize = (size: DialogSize) => {
      try { localStorage.setItem(CONFIGURATION_AUTO_FIT_SIZE_KEY, JSON.stringify(size)); } catch { /* geometry remains best effort */ }
    };
    const forgetAutoFitSize = () => {
      try { localStorage.removeItem(CONFIGURATION_AUTO_FIT_SIZE_KEY); } catch { /* geometry remains best effort */ }
    };
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
        rememberAutoFitSize(size);
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
      forgetAutoFitSize();
      operatorGeneration += 1;
      acceptedSize = size;
      if (!autoFit) { scheduleOperatorRestore(); return; }
      autoFit = false;
      pendingFit = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      contentObserver?.disconnect();
      scheduleOperatorRestore();
    };
    const fit = () => {
      if (inFlight) { pendingFit = true; return; }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = shell.current;
        if (!active || !autoFit || !root) return;
        if (inFlight) { pendingFit = true; return; }
        const height = fittedConfigurationDialogHeight(configurationDialogContentHeight(root));
        void Promise.all([nativeWindow.innerSize(), nativeWindow.scaleFactor()])
          .then(async ([size, scale]) => {
            if (!active || !autoFit || inFlight) { if (inFlight) pendingFit = true; return; }
            const logical = size.toLogical(scale);
            if (Math.abs(logical.height - height) < 0.5) { rememberAutoFitSize(logical); return; }
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
    requestConfigurationFit.current = fit;
    void Promise.all([nativeWindow.innerSize(), nativeWindow.scaleFactor()]).then(async ([size, initialScale]) => {
      const initial = size.toLogical(initialScale);
      const restoredAutoFit = storedAutoFitSize && sameDialogSize(initial, storedAutoFitSize);
      const legacyAutoFit = Math.abs(initial.width - 820) < 0.5 && isManagedConfigurationDialogHeight(initial.height);
      if (!active || (!restoredAutoFit && !legacyAutoFit)) return;
      autoFit = true;
      // Absorb a resize notification already queued by native geometry restore;
      // only a later size different from our current/requested size is user-owned.
      acceptedSize = { width: initial.width, height: initial.height };
      stopResize = await nativeWindow.onResized(async ({ payload }) => {
        const currentScale = await nativeWindow.scaleFactor();
        if (active) observedResize(payload.toLogical(currentScale));
      });
      if (!active) { stopResize(); return; }
      observer = new ResizeObserver(fit);
      if (shell.current) {
        observer.observe(shell.current);
        const content = shell.current.firstElementChild;
        if (content instanceof HTMLElement) observer.observe(content);
        contentObserver = new MutationObserver(fit);
        contentObserver.observe(shell.current, { childList: true, subtree: true });
      }
      fit();
    }).catch(() => {});
    return () => { active = false; requestConfigurationFit.current = () => {}; clearTimeout(restoreTimer); cancelAnimationFrame(frame); observer?.disconnect(); contentObserver?.disconnect(); stopResize?.(); };
  }, [kind, snapshot]);
  const title = kind === "station" ? "Station Settings" : kind === "macros" ? "Edit Macros" : kind === "keys" ? "Edit Keys" : "Configuration Settings";
  return <main ref={shell} className="contest-workspace contest-setup-dialog" data-dialog-kind={kind} aria-label={title}>
    {error && <><p role="alert">{error}</p><button type="button" onClick={() => void closeContestSetupDialog()}>Cancel</button></>}
    {snapshot ? <ContestSetupPanel value={snapshot.document} sessions={[]} catalog={snapshot.auxiliary.catalog ?? []} detachedDialog={kind}
      activeSessionID={snapshot.auxiliary.activeSessionID} effectiveMacros={snapshot.auxiliary.effectiveMacros}
      initialTab={kind === "station" ? "Station" : kind === "macros" ? "Macros" : kind === "keys" ? "Key bindings" : "Lookup"} onCancel={closeContestSetupDialog}
      onContentChange={() => requestConfigurationFit.current()}
      onSave={async document => { await saveContestSetupDialog(snapshot, document); await closeContestSetupDialog(); }}
      onCreate={async () => { throw new Error("Create contests in Contest Setup."); }}
      onOpen={async () => { throw new Error("Choose contests in Contest Setup."); }} onOpenSettings={openContestSetupService}/>
      : !error && <p role="status">Loading settings…</p>}
  </main>;
}
