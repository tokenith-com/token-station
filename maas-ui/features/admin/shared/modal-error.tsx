"use client";

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

type ModalErrorHandler = (error: unknown, fallback: string) => void;
type ModalErrorScope = { report?: ModalErrorHandler; onClose?: () => void };
const ModalErrorContext = createContext<ModalErrorScope>({});

export function ModalErrorProvider({ children, onError, onClose }: { children: ReactNode; onError?: ModalErrorHandler; onClose?: () => void }) {
  const parent = useContext(ModalErrorContext);
  return <ModalErrorContext.Provider value={{ report: onError ?? parent.report, onClose }}>{children}</ModalErrorContext.Provider>;
}

// Call only for the current dialog's failed save, never loading, testing or validation.
// A nested dialog reports to the page without invoking its parent dialog's close handler.
// Refs keep request effects stable when a parent supplies an inline close callback.
export function useModalError(onClose?: () => void) {
  const scope = useContext(ModalErrorContext);
  const handlers = useRef({ onClose: onClose ?? scope.onClose, report: scope.report });
  handlers.current = { onClose: onClose ?? scope.onClose, report: scope.report };
  return useCallback((error: unknown, fallback: string) => {
    if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") return;
    handlers.current.onClose?.();
    handlers.current.report?.(error, fallback);
  }, []);
}
