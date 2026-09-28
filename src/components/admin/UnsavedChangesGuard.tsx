"use client";
import { useEffect } from "react";

/**
 * Warns before leaving a page whose form has unsaved edits: the browser's own prompt on reload/close, and (when
 * `confirmLinks`) a confirmation when a link inside the app is clicked. Submitting the form clears the warning.
 */
export function UnsavedChangesGuard({ formId, confirmLinks = false }: { formId: string; confirmLinks?: boolean }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    let dirty = false;
    const mark = () => { dirty = true; form.dataset.dirty = "true"; };
    const clear = () => { dirty = false; delete form.dataset.dirty; };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    const onClick = (e: MouseEvent) => {
      if (!dirty || !confirmLinks) return;
      const a = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || form.contains(a)) return;
      if (!window.confirm("You have unsaved changes on this page. Leave without saving?")) { e.preventDefault(); e.stopPropagation(); }
    };
    form.addEventListener("input", mark); form.addEventListener("change", mark); form.addEventListener("submit", clear);
    window.addEventListener("beforeunload", onUnload); document.addEventListener("click", onClick, true);
    return () => {
      form.removeEventListener("input", mark); form.removeEventListener("change", mark); form.removeEventListener("submit", clear);
      window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true);
    };
  }, [formId, confirmLinks]);
  return null;
}
