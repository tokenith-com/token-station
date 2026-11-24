import type { AdminUser, ApiContext, AppData, ResourceConfig, ViewKey } from "./types";

export type ModalState<T> = {
  config: ResourceConfig<T>;
  item?: T;
  initialValues?: Record<string, string>;
};

export type ConfirmState<T> = {
  config: ResourceConfig<T>;
  item?: T;
  items?: T[];
};

export type ResourceAction<T> = {
  label: string;
  title?: string;
  pendingMessage?: string;
  visible?: (item: T, currentUser: AdminUser | null, data: AppData) => boolean;
  href?: (item: T) => string;
  navigate?: (item: T) => ViewKey;
  open?: (item: T) => void;
  confirmation?: { title: string; message: (item: T) => string; confirmLabel: string };
  run?: (ctx: ApiContext, item: T, data: AppData) => Promise<void>;
  modal?: (item: T, data: AppData) => ModalState<any>;
  doneMessage?: (item: T) => string;
};
