import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { ResourceConfig } from "../core/types";
import { tx } from "./runtime";
import { customerCopyKeys } from "./customer-copy-keys";

const CustomerCopyContext = createContext(false);

// Apply only to static interface copy, never names, IDs, options or API payloads.
export function customerCopyKey(value: string): string {
  return value.replace(/(?<!客户)(团队|项目)/g, "客户$1");
}

export function CustomerCopyProvider({ administrator, children }: { administrator: boolean; children: ReactNode }) {
  return <CustomerCopyContext.Provider value={administrator}>{children}</CustomerCopyContext.Provider>;
}

export function useCustomerTerminology(roleOverride?: boolean) {
  const inherited = useContext(CustomerCopyContext);
  const administrator = roleOverride ?? inherited;
  return useCallback((value: string | null | undefined) => tx(administrator && value && customerCopyKeys.has(value) ? customerCopyKey(value) : value), [administrator]);
}

export function CustomerStaticSummary({ render }: { render: (localize: (value: string) => string) => string }) {
  const ui = useCustomerTerminology();
  return <>{render(ui)}</>;
}

export function CustomerStaticText({ value }: { value: string }) {
  const ui = useCustomerTerminology();
  return <>{ui(value)}</>;
}

export function customerResourceConfig<T>(config: ResourceConfig<T> | undefined, administrator: boolean): ResourceConfig<T> | undefined {
  if (!config || !administrator) return config;
  const key = (value: string | undefined) => value === undefined ? undefined : customerCopyKey(value);
  return {
    ...config,
    title: customerCopyKey(config.title), eyebrow: customerCopyKey(config.eyebrow), description: customerCopyKey(config.description), createLabel: key(config.createLabel),
    columns: config.columns.map(column => ({ ...column, label: customerCopyKey(column.label) })),
    fields: config.fields.map(field => ({ ...field, label: customerCopyKey(field.label), help: key(field.help), placeholder: key(field.placeholder), emptyOptionsText: key(field.emptyOptionsText), emptySelectionText: key(field.emptySelectionText) })),
    actions: config.actions?.map(action => ({ ...action, label: customerCopyKey(action.label), title: key(action.title) })),
    toolbarActions: config.toolbarActions?.map(action => ({ ...action, label: customerCopyKey(action.label), title: key(action.title) })),
  };
}
