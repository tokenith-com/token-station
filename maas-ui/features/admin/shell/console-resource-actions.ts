import { type Dispatch, type SetStateAction } from "react";
import { type ApiContext, type AppData, type ConfirmState, type ModalState, type ReportExportHistoryItem, type ResourceAction, type ResourceConfig, type ToolbarAction, type ViewKey } from "../core/types";
import { uniqueUIID } from "../domain/formatting";
import { reportDatasetLabel } from "../domain/labels";
import { tx } from "../i18n/runtime";
import { downloadReport } from "../resources/governance-config";
import { createAdminSaveAttempt, isAuthExpiredError, restoreDefaultModelCatalog } from "../resources/payloads";
import { type ProjectWorkspaceDraft, type ProjectWorkspaceMode, saveProjectWorkspaceDraft } from "../views/project-workspace";

type Setter<T> = Dispatch<SetStateAction<T>>;
type ProjectWorkspaceState = { mode: ProjectWorkspaceMode; projectID?: string } | null;
type ConsoleResourceContext = {
  api: ApiContext;
  data: AppData;
  loading: boolean;
  projectWorkspace: ProjectWorkspaceState;
  load: (view?: ViewKey) => Promise<void>;
  selectView: (view: ViewKey) => void;
  setLoading: Setter<boolean>;
  setError: Setter<string>;
  setNotice: Setter<string>;
  setIssuedKey: Setter<string>;
  setProjectWorkspace: Setter<ProjectWorkspaceState>;
  setPendingAction: Setter<{ action: ResourceAction<any>; item: any } | null>;
  setModal: Setter<ModalState<any> | null>;
  setApiKeyWizardInitialValues: Setter<Record<string, string>>;
  setApiKeyWizardOpen: Setter<boolean>;
  setConfirmDelete: Setter<ConfirmState<any> | null>;
  setConfirmRestoreModels: Setter<boolean>;
  setUserImportOpen: Setter<boolean>;
  setReportHistory: Setter<ReportExportHistoryItem[]>;
};

export function consoleResourceActions(context: ConsoleResourceContext) {
  const { api, data, loading, projectWorkspace, load, selectView, setLoading, setError, setNotice,
    setIssuedKey, setProjectWorkspace, setPendingAction, setModal, setApiKeyWizardInitialValues,
    setApiKeyWizardOpen, setConfirmDelete, setConfirmRestoreModels, setUserImportOpen, setReportHistory } = context;

  async function saveProjectWorkspace(draft: ProjectWorkspaceDraft) {
    const existing = data.projects.find(project => project.id === projectWorkspace?.projectID);
    const attempt = createAdminSaveAttempt(api);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveProjectWorkspaceDraft(attempt.api, existing, draft);
      attempt.requested = false;
      await load("projects");
      setProjectWorkspace({ mode: "view", projectID: saved.id });
      setNotice(tx(existing ? "项目设置已保存" : "项目已创建，团队权限已配置"));
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      if (attempt.requested) {
        setProjectWorkspace(null);
        // A project can be saved before a subsequent team-assignment request fails.
        await load("projects");
      }
      setError(err instanceof Error ? err.message : tx("保存失败"));
    } finally {
      setLoading(false);
    }
  }

  async function deleteItem<T>(config: ResourceConfig<T>, item: T) {
    if (!config.remove) return;
    setLoading(true);
    setError("");
    try {
      await config.remove(api, item);
      setIssuedKey("");
      setConfirmDelete(null);
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setConfirmDelete(null);
      setError(err instanceof Error ? err.message : tx("删除失败"));
    } finally {
      setLoading(false);
    }
  }

  async function deleteItems<T>(config: ResourceConfig<T>, items: T[]) {
    if (!config.remove || items.length === 0) return;
    setLoading(true);
    setError("");
    let deletedCount = 0;
    try {
      for (const item of items) {
        await config.remove(api, item);
        deletedCount += 1;
      }
      setIssuedKey("");
      setConfirmDelete(null);
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setConfirmDelete(null);
      if (deletedCount > 0) {
        setConfirmDelete(null);
        await load();
      }
      setError(err instanceof Error ? err.message : tx("删除失败"));
    } finally {
      setLoading(false);
    }
  }

  async function restoreModelsFromDefaultCatalog() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await restoreDefaultModelCatalog(api);
      setConfirmRestoreModels(false);
      setNotice(tx("模型目录已恢复"));
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setConfirmRestoreModels(false);
      setError(err instanceof Error ? err.message : tx("操作失败"));
    } finally {
      setLoading(false);
    }
  }

  async function runResourceAction<T>(action: ResourceAction<T>, item: T, appData: AppData, confirmed = false) {
    if (loading) return;
    if (action.open) { action.open(item); return; }
    if (action.confirmation && !confirmed) { setPendingAction({ action, item }); return; }
    if (action.navigate) {
      selectView(action.navigate(item));
      return;
    }
    if (action.modal) {
      const nextModal = action.modal(item, appData);
      if (nextModal.config.view === "api-keys" && !nextModal.item) {
        setIssuedKey("");
        setApiKeyWizardInitialValues(nextModal.initialValues ?? {});
        setApiKeyWizardOpen(true);
        return;
      }
      setModal(nextModal);
      return;
    }
    if (!action.run) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await action.run(api, item, appData);
      setNotice(tx(action.doneMessage?.(item) ?? "操作已完成"));
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("操作失败"));
    } finally {
      setLoading(false);
    }
  }

  async function runToolbarAction(action: ToolbarAction, items: unknown[]) {
    if (action.kind === "import-users") {
      setError("");
      setNotice("");
      setUserImportOpen(true);
      return;
    }
    if (!action.run) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await action.run(api, items);
      setNotice(tx(action.doneMessage?.() ?? "操作已完成"));
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("操作失败"));
    } finally {
      setLoading(false);
    }
  }

  async function exportReportDataset(dataset: string) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await downloadReport(api, dataset);
      if (result) {
        setNotice(tx(`${reportDatasetLabel(dataset)} 已导出`));
        setReportHistory(current =>
          [
            {
              id: uniqueUIID("export"),
              dataset,
              file_name: result.fileName,
              period: result.period,
              exported_at: new Date().toISOString(),
            },
            ...current,
          ].slice(0, 8),
        );
      }
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("导出失败"));
    } finally {
      setLoading(false);
    }
  }
  return { saveProjectWorkspace, deleteItem, deleteItems, restoreModelsFromDefaultCatalog, runResourceAction, runToolbarAction, exportReportDataset };
}
