"use client";

import { WalletOperations } from "@/features/admin/views/wallet-operations";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type LoadedData, loadPlanForView, mergeLoadedData } from "../core/data-loading";
import { canAccessView, defaultViewForRole, rememberRecentView, standaloneViewMeta } from "../core/navigation";
import { clearProviderAccountOAuthResultFromLocation, hasPendingProviderAccountOAuthResult, isOAuthAuthorizationResponse, readOAuthLoginResult, readProviderAccountOAuthResultFromLocation, savePendingProviderAccountOAuthResult } from "../core/session";
import { notificationChannelDefaultType, notificationChannelTypes, type AdapterDescriptor, type AdminResource, type AdminUIContribution, type AdminUser, type AlertDelivery, type AlertEvent, type APIKey, type AppData, type ApprovalRequest, type AuditEvent, type BillingConnector, type BillingRecord, type BillingSyncRun, type ConfirmState, type GatewayChainPlan, languageStorageKey, type ModalState, type Model, type ModelRoute, type ModelRoutePolicy, type PluginActionDescriptor, type PluginBackgroundJobDescriptor, type PluginBackgroundJobRunRecord, type PluginDescriptor, type PluginMarketplacePlugin, type Project, type Provider, type ProviderCatalogEntry, type ProviderModel, type ProviderMonitoringSnapshot, type ProviderResource, type ReconciliationRule, type ReconciliationRun, type ReportExportHistoryItem, type RequestLog, type ResourceAction, type ResourceConfig, type SQLiteBackup, type ToolbarAction, type UsageBreakdown, type UsageDaily, type UsagePoint, type ViewKey, viewRoutes } from "../core/types";
import { emptyData, emptySummary, filterByModelCategory, filterRows } from "../domain/catalog";
import { filterAPIKeys } from "../domain/api-key-filter";
import { auditRequestPagePath } from "../domain/audit-request-page";
import { modelRouteDefaults, rowTitle } from "../domain/entities";
import { apiKeyUsageIDFromPath, uniqueUIID, viewFromPath } from "../domain/formatting";
import { pluginDetailPath, pluginDetailRouteFromPath, pluginDetailRouteFromQuery, type PluginDetailSection } from "../domain/plugin-detail-route";
import { type PluginManagerTabKey } from "../domain/plugin-management";
import { reportDatasetLabel } from "../domain/labels";
import { pluginShellPresentation } from "../domain/plugin-theme";
import { normalizePluginThemeOverrides, type PluginThemeOverrides, readPluginThemeOverrides, savePluginThemeOverrides } from "../domain/plugin-theme-overrides";
import { resolveSIMSelection, type SIMSelectionResult } from "../domain/sim-selection";
import { resourceCreateTarget } from "../domain/resource-create-target";
import { simRegistryFromPlugins } from "../domain/sim-registry";
import { type AppLanguage, bulkDeleteConfirmMessage, deleteConfirmMessage, importUsersDoneMessage, importUsersSkippedMessage, isIssuedAPIKey, setActiveLanguage, tx } from "../i18n/runtime";
import { createKeyWithCapture } from "../resources/generic-config";
import { downloadReport } from "../resources/governance-config";
import { adminFetch, adminMutate, createCustomerOnboarding, importUsersFromCSVContent, isAuthExpiredError, loadRequestLabel, notificationChannelDefaults, permissionPartialLoadMessage, readLoadError, restoreDefaultModelCatalog } from "../resources/payloads";
import { projectMemberConfig, projectMemberInitialValues } from "../resources/project-key-config";
import { resourceConfigFor } from "../resources/settings-config";
import { usePagination } from "../shared/pagination";
import { ConfirmDialog, providerTypeOptionsFromData } from "../shared/ui";
import { APIKeyAccessDialogs } from "../shared/api-key-access";
import { PageHeader, StatusStack } from "./navigation-ui";
import { AuditView } from "../views/audit";
import { ReportsView } from "../views/crud-projects"; import { WalletCrudView as CrudView } from "../views/wallet-crud";
import { DatabaseStatusView } from "../views/database-model-pricing";
import { GatewayView } from "../views/gateway-view";
import { ModelDirectoryView } from "../views/model-directory";
import { RouteStrategyView } from "../views/model-catalog";
import { modelRoutePolicyPayload } from "../views/model-routing-policy";
import { OverviewView } from "../views/overview";
import { PlaygroundPage } from "../views/playground";
import { PluginPageView } from "../views/admin-ui-plugin-pages";
import { PluginDetailView } from "../views/plugin-detail";
import { PluginsView } from "../views/plugins";
import { ProviderUpsertModal } from "../views/provider-editor";
import { ProjectWorkspace, type ProjectWorkspaceDraft, type ProjectWorkspaceMode, ProjectWorkspaceSaveError, saveProjectWorkspaceDraft } from "../views/project-workspace";
import { RoutingPolicySimulator } from "../views/routing-policy-simulator";
import { ContentSecurityPolicies, SecurityPolicyTabs } from "../views/security-policies";
import { APIKeyWizardModal, UserImportModal } from "../views/modals";
import { CustomerOnboardingDialog } from "../../admin/views/customer-onboarding";
import { EditModal, SettingsView } from "../views/settings-table";
import { BillingView, UsageView } from "../views/usage-billing";
import { APIKeyUsageView } from "../views/api-key-usage";

type SourceAdminContentProps = {
  baseURL: string;
  adminToken: string;
  currentUser: AdminUser;
  language: AppLanguage;
  theme: "light" | "dark";
  onLanguageChange: (language: AppLanguage) => void;
};

// 超管右侧内容区：复用 tokenhub 源码前端的全部视图与数据加载逻辑，
// 壳层（侧边栏、顶栏、登录）由 MaaS-ui 提供，这里只渲染右侧内容。
export function SourceAdminContent({ baseURL, adminToken, currentUser, language, theme, onLanguageChange }: SourceAdminContentProps) {
  const pathname = usePathname();
  const router = useRouter();
  const routeView = viewFromPath(pathname);
  const searchParams = useSearchParams();
  const apiKeyUsageID = apiKeyUsageIDFromPath(pathname)
    || (pathname.replace(/\/+$/, "") === "/api-keys" ? searchParams?.get("usage_key") || "" : "");
  const pluginDetailRoute = pluginDetailRouteFromPath(pathname) || pluginDetailRouteFromQuery(pathname, searchParams);
  const [activeView, setActiveView] = useState<ViewKey>(routeView);
  const [activePluginPageKey, setActivePluginPageKey] = useState(() => pluginPageKeyFromLocation());
  const [pluginManagerTab, setPluginManagerTab] = useState<PluginManagerTabKey>("installed");
  const [data, setData] = useState<AppData>(emptyData());
  const [error, setError] = useState("");
  const [routingPolicyError, setRoutingPolicyError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [modelCategoryFilter, setModelCategoryFilter] = useState("all");
  const [routeModelQuery, setRouteModelQuery] = useState(searchParams?.get("model") ?? "");
  useEffect(() => { setRouteModelQuery(searchParams?.get("model") ?? ""); }, [searchParams]);
  const [securityPolicyTab, setSecurityPolicyTab] = useState<"access" | "content">("access");
  const [modal, setModal] = useState<ModalState<any> | null>(null);
  const [modalSaveError, setModalSaveError] = useState<{ source: typeof modal; message: string } | null>(null);
  const [projectWorkspace, setProjectWorkspace] = useState<{ mode: ProjectWorkspaceMode; projectID?: string } | null>(null);
  const [providerCreateOpen, setProviderCreateOpen] = useState(false);
  const [providerEditItem, setProviderEditItem] = useState<Provider | null>(null);
  const [apiKeyWizardOpen, setApiKeyWizardOpen] = useState(false);
  const [apiKeyWizardInitialValues, setApiKeyWizardInitialValues] = useState<Record<string, string>>({});
  const [userImportOpen, setUserImportOpen] = useState(false);
  const [customerOnboardingOpen, setCustomerOnboardingOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmState<any> | null>(null);
  const [confirmRestoreModels, setConfirmRestoreModels] = useState(false);
  const [issuedKey, setIssuedKey] = useState("");
  const [pendingAction, setPendingAction] = useState<{ action: ResourceAction<any>; item: any } | null>(null);
  const [reportHistory, setReportHistory] = useState<ReportExportHistoryItem[]>([]);
  const [simSelectionPreference, setSIMSelectionPreference] = useState<unknown>(null);
  const [simSelectionLoaded, setSIMSelectionLoaded] = useState(false);
  const [themeOverrides, setThemeOverrides] = useState<PluginThemeOverrides>({});
  const [themeOverridesLoaded, setThemeOverridesLoaded] = useState(false);

  const api = useMemo(() => ({ baseURL, adminToken }), [baseURL, adminToken]);
  const activeConfig = resourceConfigFor(activeView);
  const activeMeta = activeConfig ?? standaloneViewMeta[activeView] ?? standaloneViewMeta.overview!;
  const simRegistry = useMemo(() => simRegistryFromPlugins(data.plugins), [data.plugins]);
  const shellState = useMemo(
    () => adminConsoleShellState(data, theme, simSelectionPreference, themeOverrides),
    [data, simSelectionPreference, theme, themeOverrides],
  );
  setActiveLanguage(language);
  const providerTypeOptions = providerTypeOptionsFromData(data);

  useEffect(() => {
    setSIMSelectionPreference(readAdminConsoleSIMSelectionPreference());
    setSIMSelectionLoaded(true);
  }, []);

  useEffect(() => {
    if (!simSelectionLoaded) return;
    saveAdminConsoleSIMSelectionPreference(shellState.simSelection);
  }, [shellState.simSelection, simSelectionLoaded]);

  useEffect(() => {
    if (simRegistry.themeTokens.length === 0) return;
    setThemeOverrides(readPluginThemeOverrides(simRegistry.themeTokens));
    setThemeOverridesLoaded(true);
  }, [simRegistry.themeTokens]);

  useEffect(() => {
    if (!themeOverridesLoaded) return;
    savePluginThemeOverrides(themeOverrides);
  }, [themeOverrides, themeOverridesLoaded]);

  function changeThemeTokenOverrides(themeKey: string, values: Record<string, string>) {
    setThemeOverrides((current) => normalizePluginThemeOverrides({ ...current, [themeKey]: values }, simRegistry.themeTokens));
  }

  const selectView = useCallback((view: ViewKey, options: { replace?: boolean; routeModelQuery?: string; pluginPageKey?: string } = {}) => {
    if (view !== activeView) {
      setPendingAction(null);
      setNotice("");
      setError("");
      setIssuedKey("");
      setModelCategoryFilter(view === "notification-channels" ? notificationChannelDefaultType : "all");
    }
    setActivePluginPageKey(view === "plugin-pages" ? options.pluginPageKey ?? activePluginPageKey : "");
    if (view !== "projects") setProjectWorkspace(null);
    setActiveView(view);
    const nextPath = viewRoutes[view];
    const suffix = viewURLSuffix(view, options);
    if (pathname === nextPath && suffix === currentLocationSuffix()) return;
    const nextURL = `${nextPath}${suffix}`;
    if (options.replace) {
      router.replace(nextURL);
    } else {
      router.push(nextURL);
    }
  }, [activePluginPageKey, activeView, pathname, router]);

  const selectPluginPage = useCallback((key: string) => {
    selectView("plugin-pages", { pluginPageKey: key });
  }, [selectView]);

  const selectPluginDetail = useCallback((pluginID: string, section: PluginDetailSection = "overview") => {
    router.push(pluginDetailPath(pluginID, section));
  }, [router]);

  function openRoutes(model?: Model) {
    selectView("routes", { routeModelQuery: model?.name ?? "" });
  }

  useEffect(() => {
    const result = readProviderAccountOAuthResultFromLocation();
    if (!result) return;
    savePendingProviderAccountOAuthResult(result);
    clearProviderAccountOAuthResultFromLocation();
  }, []);

  useEffect(() => {
    if (!hasPendingProviderAccountOAuthResult()) return;
    selectView("providers", { replace: true });
    setProviderCreateOpen(true);
    setNotice(tx("收到账号授权回调，已打开账号池创建向导。"));
  }, [selectView]);

  useEffect(() => {
    setActiveLanguage(language);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(languageStorageKey, language);
      document.documentElement.lang = language === "zh-CN" ? "zh-CN" : language;
    }
  }, [language]);

  useEffect(() => {
    if (!adminToken) return;
    if (!canAccessView(currentUser, activeView)) return;
    void load(activeView);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is an orchestration command; the explicit state keys define when it runs.
  }, [adminToken, currentUser, activeView]);

  useEffect(() => {
    if (activeView === "notification-channels" && !notificationChannelTypes.includes(modelCategoryFilter)) {
      setModelCategoryFilter(notificationChannelDefaultType);
    }
  }, [activeView, modelCategoryFilter]);

  useEffect(() => {
    if (!currentUser) return;
    if (!canAccessView(currentUser, activeView)) {
      selectView(defaultViewForRole(currentUser), { replace: true });
    }
  }, [currentUser, activeView, selectView]);

  useEffect(() => {
    if (!currentUser || !canAccessView(currentUser, activeView)) return;
    rememberRecentView(activeView);
  }, [activeView, currentUser]);

  useEffect(() => {
    if (isOAuthAuthorizationResponse()) return;
    if (readOAuthLoginResult()) return;
    setPendingAction(null);
    setIssuedKey("");
    setNotice("");
    setError("");
    setModelCategoryFilter(routeView === "notification-channels" ? notificationChannelDefaultType : "all");
    setActiveView(routeView);
    setActivePluginPageKey(routeView === "plugin-pages" ? pluginPageKeyFromLocation() : "");
  }, [pathname, routeView]);

  useEffect(() => {
    function onIssuedKey(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (!detail) return;
      if (isIssuedAPIKey(detail)) {
        setNotice("");
        setIssuedKey(detail);
      } else {
        setIssuedKey("");
        setNotice(detail);
      }
    }
    window.addEventListener("tokenhub-issued-key", onIssuedKey);
    return () => window.removeEventListener("tokenhub-issued-key", onIssuedKey);
  }, []);

  async function load(view: ViewKey = activeView) {
    if (!adminToken || !currentUser) return;
    if (!canAccessView(currentUser, view)) return;
    setLoading(true);
    setError("");
    try {
      const plan = loadPlanForView(currentUser, view);
      const requests: Array<{ name: string; request: Promise<Response>; optional?: boolean }> = [];
      const queue = (enabled: boolean, name: string, path: string) => {
        if (enabled) requests.push({ name, request: adminFetch(api, path) });
      };

      queue(plan.overview, "overview", "/api/admin/overview");
      queue(plan.providers, "providers", "/api/admin/providers");
      queue(plan.providerResources, "provider-resources", "/api/admin/provider-resources");
      queue(plan.providerModels, "provider-models", "/api/admin/provider-models");
      queue(plan.keys, "api-keys", "/api/admin/api-keys");
      queue(plan.routes, "routes", "/api/admin/routing-rules");
      queue(plan.logs, "audit", auditRequestPagePath({ page: 1, pageSize: 20, status: "all", query: "" }));
      queue(plan.auditEvents, "audit-events", "/api/admin/audit/events");
      queue(plan.alerts, "alerts", "/api/admin/alerts");
      queue(plan.alertDeliveries, "alert-deliveries", "/api/admin/alert-deliveries");
      queue(plan.approvals, "approvals", "/api/admin/approvals");
      queue(plan.sqliteBackups, "sqlite-backups", "/api/admin/sqlite/backups");
      queue(plan.dailyUsage, "daily-usage", "/api/admin/usage/daily");
      queue(plan.breakdown, "breakdown", "/api/admin/usage/breakdown");
      queue(plan.timeseries, "timeseries", "/api/admin/usage/timeseries");
      queue(plan.users, "users", "/api/admin/users");
      queue(plan.providerCatalog, "provider-catalog", "/api/admin/provider-catalog");
      queue(plan.providerAdapters, "provider-adapters", "/api/admin/provider-adapters");
      queue(plan.providerMonitoring, "provider-monitoring", "/api/admin/providers/monitoring");
      queue(plan.plugins, "plugins", "/api/admin/plugins");
      queue(plan.pluginMarketplace, "plugin-marketplace", "/api/admin/plugin-marketplace");
      queue(plan.pluginChain, "plugin-chain", "/api/admin/plugin-chain");
      queue(plan.pluginUI, "plugin-ui", "/api/admin/plugin-ui-manifest");
      queue(plan.pluginActions, "plugin-actions", "/api/admin/plugin-actions");
      queue(plan.pluginBackgroundJobs, "plugin-background-jobs", "/api/admin/plugin-background-jobs");
			queue(plan.billingConnectors, "billing-connectors", "/api/admin/billing/connectors");
			queue(plan.billingRecords, "billing-records", "/api/admin/billing/records");
			queue(plan.billingSyncRuns, "billing-sync-runs", "/api/admin/billing/sync-runs");
			queue(plan.reconciliationRules, "reconciliation-rules", "/api/admin/billing/reconciliation-rules");
			queue(plan.reconciliationRuns, "reconciliation-runs", "/api/admin/billing/reconciliations");
      for (const kind of plan.resources) {
        requests.push({ name: `resource:${kind}`, request: adminFetch(api, `/api/admin/resources/${kind}`), optional: true });
      }

      const responses = await Promise.all(requests.map((item) => item.request));
      const skippedResources: string[] = [];
      for (let index = 0; index < responses.length; index += 1) {
        const resp = responses[index];
        if (!resp.ok) {
          if (resp.status === 403 && requests[index].optional) {
            skippedResources.push(loadRequestLabel(requests[index].name));
            continue;
          }
          throw new Error(await readLoadError(resp, requests[index].name));
        }
      }

      const loaded: LoadedData = {};
      for (let index = 0; index < responses.length; index += 1) {
        const name = requests[index].name;
        const resp = responses[index];
        if (!resp.ok) continue;
        if (name === "overview") {
          const overview = await resp.json();
          loaded.summary = overview.summary ?? emptySummary();
          loaded.projects = overview.projects ?? [];
          loaded.providers = overview.providers ?? [];
          loaded.providerResources = overview.provider_resources ?? [];
          loaded.models = overview.models ?? [];
          loaded.alerts = overview.alerts ?? [];
        } else if (name === "providers") {
          const payload = (await resp.json()) as { data: Provider[] };
          loaded.providers = payload.data ?? [];
        } else if (name === "provider-resources") {
          const payload = (await resp.json()) as { data: ProviderResource[] };
          loaded.providerResources = payload.data ?? [];
        } else if (name === "provider-models") {
          const payload = (await resp.json()) as { data: ProviderModel[] };
          loaded.providerModels = payload.data ?? [];
        } else if (name === "api-keys") {
          const payload = (await resp.json()) as { data: APIKey[] };
          loaded.keys = payload.data ?? [];
        } else if (name === "routes") {
          const payload = (await resp.json()) as { data: ModelRoute[] };
          loaded.routes = payload.data ?? [];
        } else if (name === "audit") {
          const payload = (await resp.json()) as { data: RequestLog[] };
          loaded.logs = payload.data ?? [];
        } else if (name === "audit-events") {
          const payload = (await resp.json()) as { data: AuditEvent[] };
          loaded.auditEvents = payload.data ?? [];
        } else if (name === "alerts") {
          const payload = (await resp.json()) as { data: AlertEvent[] };
          loaded.alerts = payload.data ?? [];
        } else if (name === "alert-deliveries") {
          const payload = (await resp.json()) as { data: AlertDelivery[] };
          loaded.alertDeliveries = payload.data ?? [];
        } else if (name === "approvals") {
          const payload = (await resp.json()) as { data: ApprovalRequest[] };
          loaded.approvals = payload.data ?? [];
        } else if (name === "sqlite-backups") {
          const payload = (await resp.json()) as { data: SQLiteBackup[] };
          loaded.sqliteBackups = payload.data ?? [];
        } else if (name === "daily-usage") {
          {
            const daily = (await resp.json()) as Partial<UsageDaily>;
            loaded.dailyUsage = { ...emptyData().dailyUsage, ...daily, summary: { ...emptySummary(), ...daily.summary }, breakdown: normalizeUsageBreakdown(daily.breakdown) };
          }
        } else if (name === "breakdown") {
          loaded.breakdown = normalizeUsageBreakdown(await resp.json());
        } else if (name === "timeseries") {
          const payload = (await resp.json()) as { data: UsagePoint[] };
          loaded.timeseries = payload.data ?? [];
        } else if (name === "users") {
          const payload = (await resp.json()) as { data: AdminUser[] };
          loaded.users = payload.data ?? [];
        } else if (name === "provider-catalog") {
          const payload = (await resp.json()) as { data: ProviderCatalogEntry[] };
          loaded.providerCatalog = payload.data ?? [];
        } else if (name === "provider-adapters") {
          const payload = (await resp.json()) as { data: AdapterDescriptor[] };
          loaded.providerAdapters = payload.data ?? [];
        } else if (name === "provider-monitoring") {
          const payload = (await resp.json()) as { data: ProviderMonitoringSnapshot[] };
          loaded.providerMonitoring = payload.data ?? [];
        } else if (name === "plugins") {
          const payload = (await resp.json()) as { data: PluginDescriptor[] };
          loaded.plugins = (payload.data ?? []).map((plugin) => ({ ...plugin, kinds: plugin.kinds ?? [], placements: plugin.placements ?? [], capabilities: plugin.capabilities ?? [] }));
        } else if (name === "plugin-marketplace") {
          const payload = (await resp.json()) as {
            data?: {
              source_url?: string;
              available?: boolean;
              error?: string;
              plugins?: PluginMarketplacePlugin[];
            };
          };
          loaded.pluginMarketplace = payload.data?.plugins ?? [];
          loaded.pluginMarketplaceSourceURL = payload.data?.source_url;
          loaded.pluginMarketplaceAvailable = payload.data?.available;
          loaded.pluginMarketplaceError = payload.data?.error;
        } else if (name === "plugin-chain") {
          const payload = (await resp.json()) as { data: GatewayChainPlan };
          loaded.pluginChain = payload.data ? { ...payload.data, hooks: payload.data.hooks ?? [] } : { hooks: [] };
        } else if (name === "plugin-ui") {
          const payload = (await resp.json()) as { data: AdminUIContribution[] };
          loaded.pluginUI = payload.data ?? [];
        } else if (name === "plugin-actions") {
          const payload = (await resp.json()) as { data: PluginActionDescriptor[] };
          loaded.pluginActions = payload.data ?? [];
        } else if (name === "plugin-background-jobs") {
          const payload = (await resp.json()) as { data: PluginBackgroundJobDescriptor[]; runs?: PluginBackgroundJobRunRecord[] };
          loaded.pluginBackgroundJobs = payload.data ?? [];
          loaded.pluginBackgroundRuns = payload.runs ?? [];
				} else if (name === "billing-connectors") {
					const payload = (await resp.json()) as { data: BillingConnector[] };
					loaded.billingConnectors = payload.data ?? [];
				} else if (name === "billing-records") {
					const payload = (await resp.json()) as { data: BillingRecord[] };
					loaded.billingRecords = payload.data ?? [];
				} else if (name === "billing-sync-runs") {
					const payload = (await resp.json()) as { data: BillingSyncRun[] };
					loaded.billingSyncRuns = payload.data ?? [];
				} else if (name === "reconciliation-rules") {
					const payload = (await resp.json()) as { data: ReconciliationRule[] };
					loaded.reconciliationRules = payload.data ?? [];
				} else if (name === "reconciliation-runs") {
					const payload = (await resp.json()) as { data: ReconciliationRun[] };
					loaded.reconciliationRuns = payload.data ?? [];
        } else if (name.startsWith("resource:")) {
          const kind = name.slice("resource:".length);
          const payload = (await resp.json()) as { data: AdminResource[] };
          loaded.resources = { ...(loaded.resources ?? {}), [kind]: payload.data ?? [] };
        }
      }

      setData((current) => mergeLoadedData(current, loaded));
      if (skippedResources.length > 0) {
        setNotice(permissionPartialLoadMessage(skippedResources));
      }
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("连接失败"));
    } finally {
      setLoading(false);
    }
  }

  async function saveModal(values: Record<string, string>) {
    if (!modal) return;
    setLoading(true);
    setError("");
    setModalSaveError(null);
    try {
      if (modal.item) {
        await modal.config.update?.(api, modal.item, values, data);
      } else {
        await modal.config.create?.(api, values, data);
      }
      setModal(null);
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      const message = err instanceof Error ? err.message : tx("保存失败");
      setModalSaveError({ source: modal, message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function saveProjectWorkspace(draft: ProjectWorkspaceDraft) {
    const existing = projectWorkspace?.projectID
      ? data.projects.find((project) => project.id === projectWorkspace.projectID)
      : undefined;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveProjectWorkspaceDraft(api, existing, draft);
      await load("projects");
      setProjectWorkspace({ mode: "view", projectID: saved.id });
      setNotice(tx(existing ? "项目设置已保存" : "项目已创建，团队权限已配置"));
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      if (err instanceof ProjectWorkspaceSaveError && err.projectID) {
        await load("projects");
        setProjectWorkspace({ mode: "edit", projectID: err.projectID });
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
      setNotice(tx("模型参考目录已同步"));
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("操作失败"));
    } finally {
      setLoading(false);
    }
  }

  async function importUsersFromCSV(content: string) {
    const trimmed = content.trim();
    if (!trimmed) {
      setNotice("");
      setError(tx("请先粘贴 CSV 内容。"));
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await importUsersFromCSVContent(api, trimmed);
      const created = result.created ?? 0;
      const updated = result.updated ?? 0;
      const skipped = result.skipped ?? 0;
      setUserImportOpen(false);
      await load("users");
      setNotice(importUsersDoneMessage(created, updated, skipped));
      if (skipped > 0 && result.errors?.length) {
        setError(importUsersSkippedMessage(skipped, result.errors.slice(0, 3).join("；")));
      }
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("用户导入失败"));
    } finally {
      setLoading(false);
    }
  }

  function openCreateRoute(model: Model) {
    if (!activeConfig) return;
    if (loading) {
      setNotice("");
      setError(tx("数据加载中，请稍后再操作。"));
      return;
    }
    if (data.providers.length === 0) {
      setNotice("");
      setError(tx("请先新增供应商，再配置路由策略。"));
      selectView("providers");
      return;
    }
    const routeConfig = activeConfig as ResourceConfig<ModelRoute>;
    setModal({
      config: {
        ...routeConfig,
        title: `${tx("添加线路")} · ${model.name}`,
        fields: routeConfig.fields.filter((field) => field.key !== "model_name"),
      },
      initialValues: modelRouteDefaults(model, data),
    });
  }

  function openCreateAPIKey() {
    if (loading) {
      setNotice("");
      setError(tx("数据加载中，请稍后再操作。"));
      return;
    }
    setIssuedKey("");
    setApiKeyWizardInitialValues({});
    setApiKeyWizardOpen(true);
  }

  function quickCreateAPIKey(values: Record<string, string>, onCreated: () => void) {
    void createKeyWithCapture(api, values, setIssuedKey, setNotice, load, setLoading, setError, onCreated);
  }

  function openCreateForCurrentView() {
    if (!activeConfig) return;
    if (loading) {
      setNotice("");
      setError(tx("数据加载中，请稍后再操作。"));
      return;
    }
    switch (resourceCreateTarget(activeConfig.view)) {
      case "provider-modal":
        setProviderCreateOpen(true);
        return;
      case "project-workspace":
        setProjectWorkspace({ mode: "create" });
        return;
      case "notification-channel-modal":
        setModal({ config: activeConfig, initialValues: notificationChannelDefaults(modelCategoryFilter) });
        return;
      case "api-key-wizard":
        openCreateAPIKey();
        return;
      default:
        setModal({ config: activeConfig });
    }
  }

  async function saveModelRoutingPolicy(model: Model, policy: ModelRoutePolicy, successMessage = `已应用 ${model.name} 的模型路由策略`) {
    setLoading(true);
    setError("");
    setRoutingPolicyError("");
    setNotice("");
    try {
      await adminMutate(api, `/api/admin/model-routing-policies/${encodeURIComponent(model.name)}`, "PATCH", policy);
      setNotice(tx(successMessage));
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      const message = err instanceof Error ? err.message : tx("更新模型路由策略失败");
      setRoutingPolicyError(message);
    } finally {
      setLoading(false);
    }
  }

  function reorderModelRoutes(model: Model, orderedRoutes: ModelRoute[]) {
    return saveModelRoutingPolicy(
      model,
      modelRoutePolicyPayload("priority_only", orderedRoutes),
      `已更新 ${model.name} 的 Provider 调用顺序`,
    );
  }

  const viewItems = activeConfig?.list(data) ?? [];
  const categoryItems = filterByModelCategory(activeConfig?.view, viewItems, modelCategoryFilter, data);
  const filteredItems =
    activeConfig?.view === "api-keys" ? filterAPIKeys(categoryItems as APIKey[], query) : filterRows(categoryItems, query);
  const crudPagination = usePagination(filteredItems.length, `${activeView}:${modelCategoryFilter}:${query}`);
  const pagedItems = useMemo(
    () => filteredItems.slice(crudPagination.startIndex, crudPagination.endIndex),
    [filteredItems, crudPagination.startIndex, crudPagination.endIndex],
  );
  const workspaceProject = projectWorkspace?.projectID
    ? data.projects.find((project) => project.id === projectWorkspace.projectID)
    : undefined;

  return (
    <div
      className={`source-admin-content view-${activeView}`}
      data-layout-density={shellState.shellPresentation.density}
      data-sim-layout-key={shellState.simSelection.layout.capability?.key}
      data-sim-plugin-id={shellState.simSelection.activeSIMPluginID}
      data-sim-theme-key={shellState.simSelection.theme.capability?.key}
      data-theme={theme}
      style={shellState.shellPresentation.style}
    >
      <div className={activeView === "playground" ? "content-panel playground-content-panel" : "content-panel"}>
        {activeView === "playground" || apiKeyUsageID ? null : (
          <PageHeader activeView={activeView} data={data} meta={activeMeta} user={currentUser} onSelect={selectView} />
        )}

        <StatusStack
          error={error}
          notice={notice}
          onClearError={() => setError("")}
          onClearNotice={() => setNotice("")}
        />

        {activeView === "playground" || apiKeyUsageID ? null : <div className="divider" />}

          {apiKeyUsageID ? (
            <APIKeyUsageView api={api} data={data} user={currentUser} keyID={apiKeyUsageID} onBack={() => selectView("api-keys")} />
          ) : activeView === "overview" ? (
            <OverviewView data={data} user={currentUser} onSelectView={selectView} />
          ) : activeView === "playground" ? (
            <PlaygroundPage api={api} data={data} canViewRoutes={canAccessView(currentUser, "routes")} />
          ) : activeView === "gateway" ? (
            <GatewayView
              api={api}
              data={data}
              user={currentUser}
              language={language}
              onLanguageChange={onLanguageChange}
              loading={loading}
              onQuickCreateKey={quickCreateAPIKey}
              onManageKeys={() => selectView("api-keys")}
            />
          ) : activeView === "usage" ? (
            <UsageView api={api} data={data} user={currentUser} />
          ) : activeView === "billing" ? (
            <>
              <WalletOperations api={api} />
              <BillingView api={api} data={data} user={currentUser} loading={loading} onReload={() => load("billing")} />
            </>
          ) : activeView === "audit" ? (
            <AuditView api={api} data={data} user={currentUser} />
          ) : activeView === "database-status" ? (
            <DatabaseStatusView api={api} isDark={theme === "dark"} />
          ) : activeView === "plugins" ? (
            pluginDetailRoute ? (
              <PluginDetailView
                api={api}
                key={pluginDetailRoute.pluginID}
                activeThemeKey={shellState.simSelection.theme.capability?.key}
                data={data}
                pluginID={pluginDetailRoute.pluginID}
                section={pluginDetailRoute.section}
                managerTab={pluginManagerTab}
                themeMode={theme}
                themeOverrides={themeOverrides}
                onBack={() => router.push("/plugins")}
                onNavigate={selectPluginDetail}
                onOpenProviders={() => selectView("providers")}
                onSelectManagerTab={(tab) => {
                  setPluginManagerTab(tab);
                  router.push("/plugins");
                }}
                onThemeTokenOverridesChange={changeThemeTokenOverrides}
              />
            ) : (
              <PluginsView
                api={api}
                activeTab={pluginManagerTab}
                data={data}
                onReload={() => load("plugins")}
                onActiveTabChange={setPluginManagerTab}
                onSelectPlugin={selectPluginDetail}
              />
            )
          ) : activeView === "plugin-pages" ? (
            <PluginPageView activePageKey={activePluginPageKey} api={api} data={data} onSelectPage={selectPluginPage} />
          ) : activeView === "settings" || activeView === "role-configs" || activeView === "identity-providers" ? (
            <SettingsView
              api={api}
              data={data}
              activeTab={activeView}
              language={language}
              onLanguageChange={onLanguageChange}
              onRestoreModelCatalog={() => setConfirmRestoreModels(true)}
              onCreate={(config) => setModal({ config })}
              onEdit={(config, item) => setModal({ config, item })}
              onDelete={(config, item) => setConfirmDelete({ config, item })}
              onAction={(action, item) => void runResourceAction(action, item, data)}
              onToolbarAction={(action, items) => void runToolbarAction(action, items)}
            />
          ) : activeView === "security-policies" && activeConfig ? (
            <div className="security-policies-view">
              <SecurityPolicyTabs active={securityPolicyTab} onChange={setSecurityPolicyTab} />
              {securityPolicyTab === "content" ? (
                <ContentSecurityPolicies api={api} data={data} />
              ) : (
                <CrudView
                  config={activeConfig}
                  data={data}
                  api={api}
                  user={currentUser}
                  items={pagedItems}
                  monitorItems={filteredItems}
                  totalItems={filteredItems.length}
                  loading={loading}
                  query={query}
                  currentUser={currentUser}
                  pagination={crudPagination}
                  categoryFilter={modelCategoryFilter}
                  onCategoryFilter={setModelCategoryFilter}
                  onQuery={setQuery}
                  onCreate={openCreateForCurrentView}
                  onEdit={(item) => setModal({ config: activeConfig, item })}
                  onDelete={(item) => setConfirmDelete({ config: activeConfig, item })}
                  onAction={(action, item) => void runResourceAction(action, item, data)}
                  onToolbarAction={(action) => void runToolbarAction(action, filteredItems)}
                />
              )}
            </div>
          ) : activeView === "routes" && activeConfig ? (
            <RouteStrategyView
              onClearError={() => { setError(""); setRoutingPolicyError(""); }}
              error={routingPolicyError}
              config={activeConfig as ResourceConfig<ModelRoute>}
              data={data}
              initialQuery={routeModelQuery}
              loading={loading}
              onCreate={openCreateRoute}
              onOpenModels={() => selectView("models")}
              onOpenProviders={() => selectView("providers")}
              onEdit={(route) => setModal({ config: activeConfig, item: route })}
              onDelete={(route) => setConfirmDelete({ config: activeConfig, item: route })}
              onReorder={(model, routes) => void reorderModelRoutes(model, routes)}
              onSavePolicy={(model, policy) => void saveModelRoutingPolicy(model, policy)}
            />
          ) : activeView === "models" && activeConfig ? (
            <ModelDirectoryView
              api={api}
              config={activeConfig as ResourceConfig<Model>}
              data={data}
              loading={loading}
              readOnly={!canAccessView(currentUser, "routes")}
              onReload={() => load("models")}
              onCreateModel={() => setModal({ config: activeConfig })}
              onOpenProviders={() => selectView("providers")}
              onOpenRoutes={openRoutes}
              onEditModel={(item) => setModal({ config: activeConfig, item })}
              onDeleteModel={(item) => setConfirmDelete({ config: activeConfig, item })}
            />
          ) : activeView === "reports" && activeConfig ? (
            <ReportsView
              config={activeConfig as ResourceConfig<AdminResource>}
              data={data}
              history={reportHistory}
              loading={loading}
              onCreate={() => setModal({ config: activeConfig })}
              onEdit={(item) => setModal({ config: activeConfig, item })}
              onDelete={(item) => setConfirmDelete({ config: activeConfig, item })}
              onAction={(action, item) => void runResourceAction(action, item, data)}
              onExport={(dataset) => void exportReportDataset(dataset)}
            />
          ) : activeConfig ? (
            <>
              {activeView === "routing-policies" ? <RoutingPolicySimulator api={api} data={data} /> : null}
              <CrudView
              config={activeConfig}
              data={data}
              api={api}
              user={currentUser}
              items={pagedItems}
              monitorItems={filteredItems}
              totalItems={filteredItems.length}
              loading={loading}
              query={query}
              currentUser={currentUser}
              pagination={crudPagination}
              categoryFilter={modelCategoryFilter}
              onCategoryFilter={setModelCategoryFilter}
              onQuery={setQuery}
              onCreate={openCreateForCurrentView}
              onEdit={(item) => {
                if (activeConfig.view === "projects") {
                  setProjectWorkspace({ mode: "edit", projectID: (item as Project).id });
                  return;
                }
                if (activeConfig.view === "providers") {
                  setProviderEditItem(item as Provider);
                  return;
                }
                setModal({ config: activeConfig, item });
              }}
              onDelete={(item) => setConfirmDelete({ config: activeConfig, item })}
              onAction={(action, item) => void runResourceAction(action, item, data)}
              onProjectOpen={(project) => setProjectWorkspace({ mode: "view", projectID: project.id })}
              onToolbarAction={(action) => void runToolbarAction(action, filteredItems)}
              extraToolbarActions={activeView === "users" ? [{ label: "开通客户", onClick: () => setCustomerOnboardingOpen(true), disabled: loading }] : []}
              />
            </>
          ) : null}
        </div>

      {projectWorkspace && (!projectWorkspace.projectID || workspaceProject) ? (
        <ProjectWorkspace
          mode={projectWorkspace.mode}
          data={data}
          project={workspaceProject}
          loading={loading}
          onClose={() => {
            if (!loading) setProjectWorkspace(null);
          }}
          onEdit={() => setProjectWorkspace((current) => current ? { ...current, mode: "edit" } : current)}
          onSave={(draft) => void saveProjectWorkspace(draft)}
          onIssueKey={() => {
            if (!workspaceProject) return;
            setIssuedKey("");
            setApiKeyWizardInitialValues({ project_id: workspaceProject.id, name: `${workspaceProject.name} Key` });
            setApiKeyWizardOpen(true);
          }}
          onAction={(action) => {
            if (workspaceProject) void runResourceAction(action, workspaceProject, data);
          }}
          onCreateMember={() => {
            if (workspaceProject) setModal({ config: projectMemberConfig(), initialValues: projectMemberInitialValues(workspaceProject) });
          }}
          onEditMember={(member) => setModal({ config: projectMemberConfig(), item: member })}
          onDeleteMember={(member) => setConfirmDelete({ config: projectMemberConfig(), item: member })}
        />
      ) : null}

      {modal ? (
        <EditModal
          state={modal}
          submitError={modalSaveError?.source === modal ? modalSaveError.message : ""}
          data={data}
          api={api}
          currentUser={currentUser}
          loading={loading}
          onClose={() => setModal(null)}
          onSave={(values) => {
            if (modal.config.view === "api-keys" && !modal.item) {
              void createKeyWithCapture(api, values, setIssuedKey, setNotice, load, setLoading, setError, () => setModal(null));
              return;
            }
            void saveModal(values);
          }}
        />
      ) : null}

      {providerCreateOpen ? (
        <ProviderUpsertModal
          mode="create"
          api={api}
          catalog={data.providerCatalog}
          existingProviders={data.providers}
          providerModels={data.providerModels}
          resources={data.providerResources}
          providerAdapters={data.providerAdapters}
          pluginUI={data.pluginUI}
          pluginActions={data.pluginActions}
          plugins={data.plugins}
          providerTypeOptions={providerTypeOptions}
          loading={loading}
          onClose={() => setProviderCreateOpen(false)}
          onSaved={async () => {
            setProviderCreateOpen(false);
            await load();
          }}
          setLoading={setLoading}
          setError={setError}
          setNotice={setNotice}
        />
      ) : null}

      {providerEditItem ? (
        <ProviderUpsertModal
          mode="edit"
          provider={providerEditItem}
          api={api}
          catalog={data.providerCatalog}
          existingProviders={data.providers}
          providerModels={data.providerModels}
          routes={data.routes}
          resources={data.providerResources.filter((resource) => resource.provider_id === providerEditItem.id)}
          providerAdapters={data.providerAdapters}
          pluginUI={data.pluginUI}
          pluginActions={data.pluginActions}
          plugins={data.plugins}
          providerTypeOptions={providerTypeOptions}
          loading={loading}
          onClose={() => setProviderEditItem(null)}
          onSaved={async () => {
            setProviderEditItem(null);
            await load();
          }}
          onAccountsChanged={async () => {
            await load();
          }}
          setLoading={setLoading}
          setError={setError}
          setNotice={setNotice}
        />
      ) : null}

      {apiKeyWizardOpen ? (
        <APIKeyWizardModal
          data={data}
          currentUser={currentUser}
          initialValues={apiKeyWizardInitialValues}
          loading={loading}
          onClose={() => {
            if (!loading) {
              setApiKeyWizardOpen(false);
              setApiKeyWizardInitialValues({});
            }
          }}
          onCreate={(values) => {
            setIssuedKey("");
            void createKeyWithCapture(api, values, setIssuedKey, setNotice, load, setLoading, setError, () => {
              setApiKeyWizardOpen(false);
              setApiKeyWizardInitialValues({});
            });
          }}
        />
      ) : null}

      {userImportOpen ? (
        <UserImportModal
          loading={loading}
          onClose={() => setUserImportOpen(false)}
          onImport={(content) => void importUsersFromCSV(content)}
        />
      ) : null}

      {customerOnboardingOpen ? (
        <CustomerOnboardingDialog
          onClose={() => setCustomerOnboardingOpen(false)}
          onSubmit={async values => {
            setLoading(true);
            setError("");
            setNotice("");
            try {
              await createCustomerOnboarding(api, values);
              await load("users");
              setNotice(tx("客户开通成功"));
              return true;
            } catch (err) {
              if (!isAuthExpiredError(err)) setError(err instanceof Error ? err.message : tx("客户开通失败，请检查后重试"));
              return false;
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={tx("确认删除")}
          message={confirmDelete.items?.length ? bulkDeleteConfirmMessage(confirmDelete.items.length) : deleteConfirmMessage(rowTitle(confirmDelete.item))}
          loading={loading}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (confirmDelete.items?.length) {
              void deleteItems(confirmDelete.config, confirmDelete.items);
              return;
            }
            if (confirmDelete.item) void deleteItem(confirmDelete.config, confirmDelete.item);
          }}
        />
      ) : null}

      {confirmRestoreModels ? (
        <ConfirmDialog
          title={tx("同步模型参考目录")}
          message={tx("将从配置文件重新同步跟踪模型元数据；Provider 模型库存、路由和手工新增的其他对外模型会保留。")}
          confirmLabel="同步"
          confirmClassName="button"
          loading={loading}
          onCancel={() => setConfirmRestoreModels(false)}
          onConfirm={() => void restoreModelsFromDefaultCatalog()}
        />
      ) : null}

      {pendingAction?.action.confirmation ? (
        <ConfirmDialog
          title={pendingAction.action.confirmation.title}
          message={pendingAction.action.confirmation.message(pendingAction.item)}
          confirmLabel={pendingAction.action.confirmation.confirmLabel}
          loading={loading}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => { const pending = pendingAction; setPendingAction(null); void runResourceAction(pending.action, pending.item, data, true); }}
        />
      ) : null}
      <APIKeyAccessDialogs key={currentUser.id} baseURL={api.baseURL} issuedKey={issuedKey} onCloseIssuedKey={() => setIssuedKey("")} />

    </div>
  );

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
    setNotice(action.pendingMessage ? tx(action.pendingMessage) : "");
    try {
      await action.run(api, item, appData);
      setNotice(tx(action.doneMessage?.(item) ?? "操作已完成"));
      await load();
    } catch (err) {
      setNotice("");
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
        setReportHistory((current) => [
          {
            id: uniqueUIID("export"),
            dataset,
            file_name: result.fileName,
            period: result.period,
            exported_at: new Date().toISOString(),
          },
          ...current,
        ].slice(0, 8));
      }
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("导出失败"));
    } finally {
      setLoading(false);
    }
  }
}

export function adminConsoleShellState(
  data: AppData,
  theme: "light" | "dark",
  preference: unknown,
  themeOverrides: PluginThemeOverrides = {},
) {
  const simSelection = resolveSIMSelection({ plugins: data.plugins, preference, themeMode: theme });
  return {
    simSelection,
    shellPresentation: pluginShellPresentation(data.pluginUI, theme, {
      activeLayoutID: simSelection.layout.capability?.id,
      activeLayoutKey: simSelection.layout.capability?.key,
      activeSIMPluginID: simSelection.activeSIMPluginID || undefined,
      activeThemeID: simSelection.theme.capability?.id,
      activeThemeKey: simSelection.theme.capability?.key,
      simRegistry: simRegistryFromPlugins(data.plugins),
      themeTokenOverrides: simSelection.theme.capability ? themeOverrides[simSelection.theme.capability.key] : undefined,
    }),
  };
}

export function adminConsoleSIMSelectionPreference(selection: SIMSelectionResult) {
  return {
    simPluginID: selection.activeSIMPluginID,
    themeKey: selection.theme.capability?.key ?? "",
    themeID: selection.theme.capability?.id ?? "",
    layoutKey: selection.layout.capability?.key ?? "",
    layoutID: selection.layout.capability?.id ?? "",
  };
}

export function readAdminConsoleSIMSelectionPreference(storage?: Pick<Storage, "getItem">) {
  if (typeof window === "undefined") return null;
  const raw = (storage ?? window.localStorage).getItem(adminConsoleSIMSelectionStorageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function saveAdminConsoleSIMSelectionPreference(selection: SIMSelectionResult, storage?: Pick<Storage, "setItem">) {
  if (typeof window === "undefined") return;
  (storage ?? window.localStorage).setItem(adminConsoleSIMSelectionStorageKey, JSON.stringify(adminConsoleSIMSelectionPreference(selection)));
}

export const adminConsoleSIMSelectionStorageKey = "tokenhub.admin.sim.selection.v1";

function pluginPageKeyFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("plugin_page") ?? "";
}

function viewURLSuffix(view: ViewKey, options: { pluginPageKey?: string; routeModelQuery?: string }) {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash;
  const params = new URLSearchParams();
  if (view === "plugin-pages" && options.pluginPageKey) params.set("plugin_page", options.pluginPageKey);
  if (view === "routes" && options.routeModelQuery) params.set("model", options.routeModelQuery);
  const query = params.toString();
  return `${query ? `?${query}` : ""}${hash}`;
}

function currentLocationSuffix() {
  if (typeof window === "undefined") return "";
  return `${window.location.search}${window.location.hash}`;
}

// Go 后端空切片会序列化为 null，这里把用量拆分里的各个列表兜底成数组。
function normalizeUsageBreakdown(raw: Partial<UsageBreakdown> | null | undefined): UsageBreakdown {
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    ...raw,
    projects: list(raw?.projects),
    models: list(raw?.models),
    members: list(raw?.members),
    providers: list(raw?.providers),
    provider_resources: list(raw?.provider_resources),
    cost_centers: list(raw?.cost_centers),
    api_keys: list(raw?.api_keys),
  };
}
