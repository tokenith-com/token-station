"use client";
import { exchangeOAuthLoginCode, resolvePendingOAuthLoginResult, safeOAuthLoginErrorCode } from "../domain/oauth-login";
import { modelRoutePolicyPayload } from "../views/model-routing-policy";
import { type ModelRoutePolicy } from "../core/types";
import { IssuedKeyModal } from "../shared/issued-key-modal";
import { ModalErrorProvider } from "../shared/modal-error";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { type LoadedData, loadPlanForView, mergeLoadedData } from "../core/data-loading";
import { backendRequest, configureBackendBaseURL, loginWithPassword, resetLoginPassword } from "../core/api-client";
import { allNavGroupTitles, appRole, canAccessView, defaultViewForRole, rememberRecentView, standaloneViewMeta } from "../core/navigation";
import {
  clearOAuthAuthorizationResponse,
  clearOAuthLoginResult,
  clearPendingOAuthLogin,
  clearProviderAccountOAuthResultFromLocation,
  clearSavedSession,
  forwardOAuthAuthorizationResponse,
  hasPendingProviderAccountOAuthResult,
  isOAuthAuthorizationResponse,
  isProviderAccountOAuthAuthorizationResponse,
  readOAuthLoginResult,
  readPendingOAuthLogin,
  consumePasswordResetToken,
  readProviderAccountOAuthResultFromLocation,
  readSavedSession,
  savePendingProviderAccountOAuthResult,
  saveSession,
} from "../core/session";
import {
  type AdminResource,
  type AdminUser,
  type AlertDelivery,
  type AlertEvent,
  type APIKey,
  type AppData,
  type ApprovalRequest,
  type AuditEvent,
  authExpiredEventName,
  type ConfirmState,
  languageStorageKey,
  type ModalState,
  type Model,
  type ModelRoute,
  notificationChannelTypes,
  type Provider,
  type ProviderCatalogEntry,
  type ProviderModel,
  type ProviderMonitoringSnapshot,
  type ProviderResource,
  type Project,
  type ReportExportHistoryItem,
  type RequestLog,
  type ResourceAction,
  type ResourceConfig,
  type SettingsTabKey,
  type SQLiteBackup,
  type UsageBreakdown,
  type UsagePoint,
  type ViewKey,
  viewRoutes,
} from "../core/types";
import { emptyData, emptySummary, filterByModelCategory, filterRows } from "../domain/catalog";
import { auditRequestPagePath } from "../domain/audit-request-page";
import { modelRouteDefaults, rowTitle } from "../domain/entities";
import { viewFromPath } from "../domain/formatting";
import { filterAPIKeys } from "../domain/api-key-filter";
import {
  type AppLanguage,
  bulkDeleteConfirmMessage,
  deleteConfirmMessage,
  formatTranslationTemplate,
  importUsersDoneMessage,
  importUsersSkippedMessage,
  isIssuedAPIKey,
  readSavedLanguage,
  setActiveLanguage,
  tx,
} from "../i18n/runtime";
import { createKeyWithCapture } from "../resources/generic-config";
import {
  adminFetch,
  adminMutate,
  createAdminSaveAttempt,
  createCustomerOnboarding,
  createTeamMember,
  importUsersFromCSVContent,
  isAuthExpiredError,
  loadRequestLabel,
  notificationChannelDefaults,
  permissionPartialLoadMessage,
  readAdminError,
  readLoadError,
} from "../resources/payloads";
import { apiKeyStatusAction, projectMemberConfig, projectMemberInitialValues } from "../resources/project-key-config";
import { resourceConfigFor } from "../resources/settings-config";
import { APIKeyWizardModal, UserImportModal } from "../views/modals";
import { ConfirmDialog, providerTypeOptionsFromData } from "../shared/ui";
import { currentOAuthReturnURL, LoginView, ResetPasswordView } from "../shared/auth";
import { readActivationToken } from "../shared/consumer-activation";
import { PortalHome } from "../shared/portal-home";
import { PageHeader, Sidebar, StatusStack, TopNav } from "./navigation-ui";
import { AuditView } from "../views/audit";
import { ProviderChannelView } from "../views/provider-channel-view";
import { CrudView, ReportsView } from "../views/crud-projects";
import { DatabaseStatusView } from "../views/database-model-pricing";
import { GatewayView } from "../views/gateway-view";
import { ModelDirectoryView } from "../views/model-directory";
import { RouteStrategyView } from "../views/model-catalog";
import { OverviewView } from "../views/overview";
import { PersonalAPIKeysView } from "../views/personal-api-keys";
import { configureAPIKeySecretContext } from "../shared/api-key-value";
import { APIKeyAccessDialogs } from "../shared/api-key-access";
import { APIKeyUsageView } from "../views/api-key-usage";
import { PlaygroundPage } from "../views/playground";
import { PlatformAccountsView, type PlatformAccountValues } from "../views/platform-accounts";
import { TeamGroupsView, type TeamGroupValues } from "../views/team-groups";
import { ConsumerRechargeView } from "../views/recharge";
import { GuestCostDetailsView } from "../views/guest-cost-details";
import { ProviderUpsertModal } from "../views/provider-editor";
import { ProjectWorkspace, type ProjectWorkspaceMode } from "../views/project-workspace";
import { consoleResourceActions } from "./console-resource-actions";
import { QuickAPIKeyModal } from "../views/quick-access";
import { RoleManagementEditModal, RoleManagementView } from "../views/role-management";
import { EditModal, SettingsView } from "../views/settings-table";
import { usePagination } from "../shared/pagination";
import { BillingView, UsageView } from "../views/usage-billing";
import { scopePortalData, type Portal } from "../core/portal";
import { PortalContext } from "../core/portal-context";
import { SourceAdminContent } from "../../source-admin/shell/source-admin-content";
import { useLoginIdentityProviders } from "./use-login-identity-providers";

const themeStorageKey = "tokenhub.theme";
// Keep account onboarding and role-shared views here; other admin views reuse the source console.
const maasOnlyViews = new Set<ViewKey>(["balance-recharge", "usage", "models", "playground"]);
function usesSourceAdminContent(user: AdminUser, view: ViewKey) {
  if (appRole(user.role) !== "admin") return false;
  return !maasOnlyViews.has(view);
}
const apiKeyPageSize = 1000;
type ConsoleProps = { defaultBaseURL: string; portal?: Portal };

export function AdminConsole(props: ConsoleProps) {
  return (
    <PortalContext.Provider value={props.portal ?? "b"}>
      <Suspense><AdminConsoleContent {...props} /></Suspense>
    </PortalContext.Provider>
  );
}

function AdminConsoleContent({ defaultBaseURL, portal = "b" }: ConsoleProps) {
  // 静态部署下浏览器始终直连后端；必须在子组件发出第一个请求之前完成配置（纯赋值、可重复执行）。
  configureBackendBaseURL(defaultBaseURL);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const apiKeyUsageID = pathname.replace(/\/+$/, "") === "/api-keys" ? searchParams?.get("usage_key") || "" : "";
  const router = useRouter();
  const routeView = viewFromPath(pathname);
  const [language, setLanguage] = useState<AppLanguage>(() => readSavedLanguage());
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [baseURL, setBaseURL] = useState(defaultBaseURL);
  const [adminToken, setAdminToken] = useState("");
  const currentToken = useRef(adminToken);
  currentToken.current = adminToken;
  const loadGeneration = useRef(0);
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [pendingLoginOTP, setPendingLoginOTP] = useState<{ identity: string; payload: Awaited<ReturnType<typeof loginWithPassword>> } | null>(null);
  const [oauthReturnURL, setOAuthReturnURL] = useState(() => currentOAuthReturnURL());
  const [bootstrapped, setBootstrapped] = useState(false);
  const loginIdentityProviders = useLoginIdentityProviders(bootstrapped && !currentUser && portal === "b", defaultBaseURL);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(allNavGroupTitles.map(title => [title, true])));
  const [activeView, setActiveView] = useState<ViewKey>(routeView);
  const [data, setData] = useState<AppData>(emptyData());
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [routingPolicyError, setRoutingPolicyError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [modelCategoryFilter, setModelCategoryFilter] = useState("all");
  const routeModelQuery = searchParams?.get("model") ?? "";
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>("role-configs");
  const [modal, setModal] = useState<ModalState<any> | null>(null);
  const [modalSaveError, setModalSaveError] = useState<{ state: ModalState<any>; message: string } | null>(null);
  const [projectWorkspace, setProjectWorkspace] = useState<{ mode: ProjectWorkspaceMode; projectID?: string } | null>(null);
  const [providerCreateOpen, setProviderCreateOpen] = useState(false);
  const [providerEditItem, setProviderEditItem] = useState<Provider | null>(null);
  const [quickAPIKeyOpen, setQuickAPIKeyOpen] = useState(false);
  const [apiKeyWizardOpen, setApiKeyWizardOpen] = useState(false);
  const [apiKeyWizardInitialValues, setApiKeyWizardInitialValues] = useState<Record<string, string>>({});
  const [userImportOpen, setUserImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmState<any> | null>(null);
  const [confirmRestoreModels, setConfirmRestoreModels] = useState(false);
  const [issuedKey, setIssuedKey] = useState("");
  const [pendingAction, setPendingAction] = useState<{ action: ResourceAction<any>; item: any } | null>(null);

  const [reportHistory, setReportHistory] = useState<ReportExportHistoryItem[]>([]);
  const [resetToken, setResetToken] = useState("");

  const api = useMemo(() => ({ baseURL, adminToken }), [baseURL, adminToken]);
  const providerTypeOptions = providerTypeOptionsFromData(data);
  const activeConfig = resourceConfigFor(activeView);
  const activeMeta = activeConfig ?? standaloneViewMeta[activeView] ?? standaloneViewMeta.overview!;
  setActiveLanguage(language);

  useEffect(() => {
    const sidebarBreakpoint = window.matchMedia("(max-width: 980px)");
    const syncSidebarWithViewport = (event?: MediaQueryListEvent) => {
      setSidebarCollapsed(event?.matches ?? sidebarBreakpoint.matches);
    };

    syncSidebarWithViewport();
    sidebarBreakpoint.addEventListener("change", syncSidebarWithViewport);

    return () => {
      sidebarBreakpoint.removeEventListener("change", syncSidebarWithViewport);
    };
  }, []);

  function changeLanguage(nextLanguage: AppLanguage) {
    setLanguage(nextLanguage);
  }

  useEffect(() => {
    if (window.localStorage.getItem(themeStorageKey) === "dark") setTheme("dark");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    setTheme(value => {
      const next = value === "light" ? "dark" : "light";
      window.localStorage.setItem(themeStorageKey, next);
      return next;
    });
  }

  function selectView(view: ViewKey, options: { replace?: boolean; routeModelQuery?: string } = {}) {
    if (view !== "projects") setProjectWorkspace(null);
    if (view === "settings" && currentUser && appRole(currentUser.role) === "admin") {
      setSettingsTab("role-configs");
    }
    if (view !== activeView) {
      setPendingAction(null);
      setNotice("");
      setError("");
      setIssuedKey("");
      setModelCategoryFilter(view === "notification-channels" ? "webhook" : "all");
    }
    setActiveView(view);
    const nextPath = viewRoutes[view];
    if (pathname === nextPath && !apiKeyUsageID && view !== "routes") return;
    const nextParams = new URLSearchParams(searchParams?.toString());
    nextParams.delete("usage_key");
    if (view === "routes" && options.routeModelQuery) nextParams.set("model", options.routeModelQuery);
    else if (activeView === "routes" || view === "routes") nextParams.delete("model");
    const suffix = `${nextParams.size ? `?${nextParams}` : ""}${typeof window === "undefined" ? "" : window.location.hash}`;
    const nextURL = `${nextPath}${suffix}`;
    if (options.replace) {
      router.replace(nextURL);
    } else {
      router.push(nextURL);
    }
  }

  function openRoutes(model?: Model) {
    selectView("routes", { routeModelQuery: model?.name ?? "" });
  }

  useEffect(() => {
    let cancelled = false;
    async function bootstrapSession() {
      const passwordResetToken = consumePasswordResetToken();
      if (passwordResetToken) {
        clearSavedSession(portal);
        clearOAuthLoginResult();
        clearOAuthAuthorizationResponse();
        clearPendingOAuthLogin();
        setResetToken(passwordResetToken);
        setBootstrapped(true);
        return;
      }
      if (readActivationToken()) {
        // An email activation link must reach the activation form even when
        // another account is signed in on this browser.
        clearSavedSession(portal);
        setCurrentUser(null);
        setBootstrapped(true);
        return;
      }
      const saved = readSavedSession(portal);
      const pendingLogin = readPendingOAuthLogin();
      const oauthCallback = resolvePendingOAuthLoginResult(window.location, pendingLogin);
      const oauth = oauthCallback.status === "ready" ? oauthCallback.result : null;
      if (oauthCallback.status === "none" && pendingLogin && forwardOAuthAuthorizationResponse(pendingLogin.baseURL)) return;
      if (oauthCallback.status === "none" && !isProviderAccountOAuthAuthorizationResponse() && isOAuthAuthorizationResponse()) {
        clearOAuthAuthorizationResponse();
        clearPendingOAuthLogin();
        setLoginError(tx("OAuth 登录失败"));
        setBootstrapped(true);
        return;
      }
      if (oauthCallback.status === "unexpected") {
        clearOAuthLoginResult();
        clearPendingOAuthLogin();
        setLoginError(tx("OAuth 登录失败"));
        setBootstrapped(true);
        return;
      }
      const sessionBaseURL = defaultBaseURL;
      if (oauth?.error) {
        clearOAuthLoginResult();
        clearPendingOAuthLogin();
        setLoginError(formatTranslationTemplate(tx("OAuth 登录失败（{code}），请重试或联系管理员。"), { code: safeOAuthLoginErrorCode(oauth.error) }));
        setBootstrapped(true);
        return;
      }
      if (oauth?.code && oauthCallback.status === "ready") {
        setBaseURL(sessionBaseURL);
        setLoading(true);
        try {
          const exchange = await exchangeOAuthLoginCode(sessionBaseURL, oauth.code, oauthCallback.codeVerifier, (input, init) => backendRequest(String(input).slice(sessionBaseURL.length), init));
          if (!exchange.ok) throw new Error(await readAdminError(new Response(exchange.body, { status: exchange.status }), tx("登录失败")));
          const payload = JSON.parse(exchange.body) as { token?: string; user?: AdminUser; expires_at?: string };
          if (!payload.token || !payload.user || !payload.expires_at) throw new Error(tx("登录失败"));
          if (cancelled) return;
          setData(emptyData());
          setAdminToken(payload.token);
          setCurrentUser(payload.user);
          saveSession({ baseURL: sessionBaseURL, token: payload.token, user: payload.user, expiresAt: payload.expires_at }, portal);
          setLoginError("");
          setError("");
        } catch (err) {
          if (!cancelled) setLoginError(err instanceof Error ? tx(err.message) : tx("OAuth 登录失败"));
        } finally {
          clearOAuthLoginResult();
          clearPendingOAuthLogin();
          if (!cancelled) {
            setLoading(false);
            setBootstrapped(true);
          }
        }
        return;
      }
      if (saved) {
        if (saved.token.startsWith("tokenhub-mock:") || saved.baseURL !== defaultBaseURL) {
          clearSavedSession(portal);
        } else {
          setAdminToken(saved.token);
          setCurrentUser(saved.user);
        }
      }
      if (!cancelled) setBootstrapped(true);
    }
    void bootstrapSession();
    return () => {
      cancelled = true;
    };
  }, [defaultBaseURL, portal]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOAuthReturnURL(currentOAuthReturnURL());
    }
  }, []);

  useEffect(() => {
    const result = readProviderAccountOAuthResultFromLocation();
    if (!result) return;
    savePendingProviderAccountOAuthResult(result);
    clearProviderAccountOAuthResultFromLocation();
  }, []);

  useEffect(() => {
    if (!currentUser || !hasPendingProviderAccountOAuthResult()) return;
    selectView("providers", { replace: true });
    setProviderCreateOpen(true);
    setNotice(tx("收到账号授权回调，已打开账号池创建向导。"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    setActiveLanguage(language);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(languageStorageKey, language);
      document.documentElement.lang = language === "zh-CN" ? "zh-CN" : language;
    }
  }, [language]);

  useEffect(() => {
    if (!bootstrapped || !adminToken || !currentUser) return;
    if (!canAccessView(currentUser, activeView)) return;
    if (usesSourceAdminContent(currentUser, activeView)) return;
    void load(activeView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, adminToken, currentUser, activeView]);

  useEffect(() => {
    if (activeView === "notification-channels" && !notificationChannelTypes.includes(modelCategoryFilter)) {
      setModelCategoryFilter("webhook");
    }
  }, [activeView, modelCategoryFilter]);

  useEffect(() => {
    if (!currentUser) return;
    if (!canAccessView(currentUser, activeView)) {
      selectView(defaultViewForRole(currentUser), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, activeView]);

  useEffect(() => {
    if (!currentUser || !canAccessView(currentUser, activeView)) return;
    rememberRecentView(activeView);
  }, [activeView, currentUser]);

  useEffect(() => {
    if (isOAuthAuthorizationResponse()) return;
    if (readOAuthLoginResult()) return;
    setNotice("");
    setError("");
    setModelCategoryFilter(routeView === "notification-channels" ? "webhook" : "all");
    setActiveView(routeView);
  }, [routeView]);

  useEffect(() => {
    function onAuthExpired(event: Event) {
      if ((event as CustomEvent<string>).detail !== currentToken.current) return;
      loadGeneration.current += 1;
      currentToken.current = "";
      clearSavedSession(portal);
      setAdminToken("");
      setCurrentUser(null);
      setData(emptyData());
      setModal(null);
      setProjectWorkspace(null);
      setPendingAction(null);
      setProviderCreateOpen(false);
      setProviderEditItem(null);
      setQuickAPIKeyOpen(false);
      setApiKeyWizardOpen(false);
      setApiKeyWizardInitialValues({});
      setUserImportOpen(false);
      setConfirmDelete(null);
      setConfirmRestoreModels(false);
      setIssuedKey("");
      setNotice("");
      setError("");
      setActiveView("overview");
      setModelCategoryFilter("all");
      router.replace(viewRoutes.overview);
      setLoading(false);
    }
    window.addEventListener(authExpiredEventName, onAuthExpired);
    return () => window.removeEventListener(authExpiredEventName, onAuthExpired);
  }, [router, portal]);

  useEffect(() => {
    if (currentUser && usesSourceAdminContent(currentUser, activeView)) return;
    function onIssuedKey(event: Event) {
      if (currentUser && usesSourceAdminContent(currentUser, activeView)) return;
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
  }, [currentUser, activeView]);

  useEffect(() => configureAPIKeySecretContext(api), [api]);

  async function load(view: ViewKey = activeView) {
    if (!adminToken || !currentUser) return;
    if (!canAccessView(currentUser, view)) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      const plan = loadPlanForView(currentUser, view);
      const requests: Array<{ name: string; request: Promise<Response>; optional?: boolean }> = [];
      const queue = (enabled: boolean, name: string, path: string) => {
        if (enabled) requests.push({ name, request: adminFetch(api, path) });
      };

      queue(plan.overview, "overview", "/api/admin/overview");
      queue(plan.models, "models", "/api/admin/models");
      queue(plan.providers, "providers", "/api/admin/providers");
      queue(plan.providerResources, "provider-resources", "/api/admin/provider-resources");
      queue(plan.providerModels, "provider-models", "/api/admin/provider-models");
      queue(plan.keys, "api-keys", `/api/admin/api-keys?page=1&page_size=${apiKeyPageSize}&limit=${apiKeyPageSize}`);
      queue(plan.routes, "routes", "/api/admin/routing-rules");
      // 总览的请求健康时间线取最近 100 条（后端单页上限）
      queue(plan.logs, "audit", auditRequestPagePath({ page: 1, pageSize: view === "overview" ? 100 : 20, status: "all", query: "" }));
      queue(plan.auditEvents, "audit-events", "/api/admin/audit/events");
      queue(plan.alerts, "alerts", "/api/admin/alerts");
      queue(plan.alertDeliveries, "alert-deliveries", "/api/admin/alert-deliveries");
      queue(plan.approvals, "approvals", "/api/admin/approvals");
      queue(plan.sqliteBackups, "sqlite-backups", "/api/admin/sqlite/backups");
      queue(plan.breakdown, "breakdown", "/api/admin/usage/breakdown");
      queue(plan.timeseries, "timeseries", "/api/admin/usage/timeseries");
      queue(plan.users, "users", "/api/admin/users");
      queue(plan.providerCatalog, "provider-catalog", "/api/admin/provider-catalog");
      // Provider monitoring and plugin metadata follow master: missing data must surface an error.
      // Other views retain compatibility with older Cloud endpoints.
      const extensions: Array<[boolean, string, string]> = [
        [plan.providerAdapters, "providerAdapters", "/api/admin/provider-adapters"],
        [plan.plugins, "plugins", "/api/admin/plugins"],
        [plan.pluginUI, "pluginUI", "/api/admin/plugin-ui-manifest"],
        [plan.pluginActions, "pluginActions", "/api/admin/plugin-actions"],
        [plan.pluginMarketplace, "pluginMarketplace", "/api/admin/plugin-marketplace"],
        [plan.pluginChain, "pluginChain", "/api/admin/plugin-chain"],
        [plan.pluginBackgroundJobs, "pluginBackgroundJobs", "/api/admin/plugin-background-jobs"],
        [plan.dailyUsage, "dailyUsage", "/api/admin/usage/daily"],
        [plan.billingConnectors, "billingConnectors", "/api/admin/billing/connectors"],
        [plan.billingRecords, "billingRecords", "/api/admin/billing/records"],
        [plan.billingSyncRuns, "billingSyncRuns", "/api/admin/billing/sync-runs"],
        [plan.reconciliationRules, "reconciliationRules", "/api/admin/billing/reconciliation-rules"],
        [plan.reconciliationRuns, "reconciliationRuns", "/api/admin/billing/reconciliations"],
      ];
      for (const [enabled, name, path] of extensions) {
        if (enabled && (name === "dailyUsage" || appRole(currentUser.role) === "admin")) {
          requests.push({ name: `extension:${name}`, request: adminFetch(api, path), optional: view !== "providers" });
        }
      }
      if (plan.providerMonitoring) {
        requests.push({ name: "provider-monitoring", request: adminFetch(api, "/api/admin/providers/monitoring"), optional: view !== "providers" });
      }
      for (const kind of plan.resources) {
        requests.push({ name: `resource:${kind}`, request: adminFetch(api, `/api/admin/resources/${kind}`), optional: true });
      }

      const responses = await Promise.all(requests.map(item => item.request));
      if (generation !== loadGeneration.current) return;
      const skippedResources: string[] = [];
      let monitoringUnavailable = false;
      for (let index = 0; index < responses.length; index += 1) {
        const resp = responses[index];
        if (!resp.ok) {
          if (
            requests[index].optional &&
            (resp.status === 403 || ([404, 405].includes(resp.status) && (requests[index].name === "provider-monitoring" || requests[index].name.startsWith("extension:"))))
          ) {
            if (resp.status === 403) skippedResources.push(loadRequestLabel(requests[index].name));
            else if (requests[index].name === "provider-monitoring") monitoringUnavailable = true;
            continue;
          }
          throw new Error(await readLoadError(resp, requests[index].name));
        }
      }

      const loaded: LoadedData = {};
      for (let index = 0; index < responses.length; index += 1) {
        if (responses[index].ok) continue;
        const name = requests[index].name;
        if (name === "provider-monitoring") loaded.providerMonitoring = [];
        if (name.startsWith("extension:")) {
          const field = name.slice("extension:".length) as keyof AppData;
          Object.assign(loaded, { [field]: emptyData()[field] });
        }
        if (name.startsWith("resource:")) {
          loaded.resources = { ...(loaded.resources ?? {}), [name.slice("resource:".length)]: [] };
        }
      }
      for (let index = 0; index < responses.length; index += 1) {
        const name = requests[index].name;
        const resp = responses[index];
        if (!resp.ok) continue;
        if (name.startsWith("extension:")) {
          const field = name.slice("extension:".length);
          const payload = await resp.json();
          if (field === "pluginMarketplace") {
            loaded.pluginMarketplace = payload.data?.plugins ?? [];
            loaded.pluginMarketplaceSourceURL = payload.data?.source_url;
            loaded.pluginMarketplaceAvailable = payload.data?.available;
            loaded.pluginMarketplaceError = payload.data?.error;
          } else if (field === "pluginChain") {
            loaded.pluginChain = payload.data ? { ...payload.data, hooks: payload.data.hooks ?? [] } : { hooks: [] };
          } else if (field === "plugins") {
            loaded.plugins = ((payload.data ?? []) as AppData["plugins"]).map((plugin) => ({ ...plugin, kinds: plugin.kinds ?? [], placements: plugin.placements ?? [], capabilities: plugin.capabilities ?? [] }));
          } else if (field === "dailyUsage") {
            loaded.dailyUsage = { ...emptyData().dailyUsage, ...payload, summary: { ...emptySummary(), ...payload?.summary }, breakdown: normalizeUsageBreakdown(payload?.breakdown) };
          } else {
            Object.assign(loaded, { [field]: payload.data ?? [] });
            if (field === "pluginBackgroundJobs") loaded.pluginBackgroundRuns = payload.runs ?? [];
          }
        } else if (name === "overview") {
          const overview = await resp.json();
          loaded.summary = { ...emptySummary(), ...overview.summary };
          loaded.projects = overview.projects ?? [];
          loaded.providers = overview.providers ?? [];
          loaded.providerResources = overview.provider_resources ?? [];
          loaded.models = overview.models ?? [];
          loaded.alerts = overview.alerts ?? [];
        } else if (name === "models") {
          const payload = (await resp.json()) as { data: Model[] };
          loaded.models = payload.data ?? [];
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
          const payload = (await resp.json()) as { data: APIKey[]; pagination?: { total_pages?: number } };
          const keys = [...(payload.data ?? [])];
          const totalPages = Math.min(payload.pagination?.total_pages ?? 1, 50);
          for (let page = 2; page <= totalPages; page += 1) {
            const next = await adminFetch(api, `/api/admin/api-keys?page=${page}&page_size=${apiKeyPageSize}&limit=${apiKeyPageSize}`);
            if (!next.ok) throw new Error(await readLoadError(next, name));
            keys.push(...(((await next.json()) as { data?: APIKey[] }).data ?? []));
          }
          loaded.keys = keys;
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
        } else if (name === "provider-monitoring") {
          const payload = (await resp.json()) as { data: ProviderMonitoringSnapshot[] };
          loaded.providerMonitoring = payload.data ?? [];
        } else if (name.startsWith("resource:")) {
          const kind = name.slice("resource:".length);
          const payload = (await resp.json()) as { data: AdminResource[] };
          loaded.resources = { ...(loaded.resources ?? {}), [kind]: payload.data ?? [] };
        }
      }

      if (generation !== loadGeneration.current) return;
      setData(current => scopePortalData(mergeLoadedData(current, loaded), portal));
      if (skippedResources.length > 0) {
        setNotice(permissionPartialLoadMessage(skippedResources));
      } else if (monitoringUnavailable) {
        setNotice(tx("部分监控数据暂不可用"));
      }
    } catch (err) {
      if (generation !== loadGeneration.current || isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("连接失败"));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }

  function completeLogin(payload: Awaited<ReturnType<typeof loginWithPassword>>) {
    setPendingLoginOTP(null);
    setData(emptyData());
    setAdminToken(payload.token);
    setCurrentUser(payload.user);
    saveSession({ baseURL, token: payload.token, user: payload.user, expiresAt: payload.expires_at }, portal);
  }

  function verifyLoginOTPPreview(code: string) {
    if (process.env.NODE_ENV !== "development" || portal !== "b" || !pendingLoginOTP) return;
    if (Date.parse(pendingLoginOTP.payload.expires_at) <= Date.now()) {
      setPendingLoginOTP(null);
      setLoginError(tx("登录已过期，请重新输入账号密码"));
      return;
    }
    if (code !== "123456") {
      setLoginError(tx("演示验证码错误，请输入 123456"));
      return;
    }
    setLoginError("");
    completeLogin(pendingLoginOTP.payload);
  }

  async function login(identity: string, password: string) {
    setLoginError("");
    setLoading(true);
    setError("");
    try {
      const payload = await loginWithPassword(identity, password);
      const role = appRole(payload.user.role);
      if (process.env.NODE_ENV === "development" && portal === "b" && (role === "admin" || role === "team_leader")) {
        //! 显示验证码（当前开发演示）：执行 setPendingLoginOTP，保留 return，验证通过后才完成登录。
        //! 不显示验证码并直接登录：注释下一行，启用 completeLogin(payload)，保留 return；两种方式只启用一种。
        //! 不要仅改为 setPendingLoginOTP(null)，否则 return 会阻止完成登录。
        // setPendingLoginOTP({ identity: identity.trim(), payload }); // 显示验证码
        completeLogin(payload); //  不显示验证码，直接登录
        return;
      }
      completeLogin(payload);
    } catch (err) {
      setLoginError(err instanceof Error ? tx(err.message) : tx("登录失败"));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(token: string, password: string) {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      await resetLoginPassword(token, password);
      window.history.replaceState(null, "", window.location.pathname);
      setNotice(tx("密码已重置，请使用新密码登录"));
    } catch (err) {
      setError(err instanceof Error ? tx(err.message) : tx("密码重置失败"));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    setPendingLoginOTP(null);
    setLoginError("");
    setIssuedKey("");
    loadGeneration.current += 1;
    const revokeSession = adminToken ? adminFetch(api, "/api/admin/auth/logout", { method: "POST" }).catch(() => undefined) : Promise.resolve();
    clearSavedSession(portal);
    currentToken.current = "";
    setAdminToken("");
    setCurrentUser(null);
    setData(emptyData());
    setModal(null);
    setProjectWorkspace(null);
    setPendingAction(null);
    setProviderCreateOpen(false);
    setProviderEditItem(null);
    setQuickAPIKeyOpen(false);
    setConfirmDelete(null);
    setIssuedKey("");
    setError("");
    setNotice("");
    setLoading(false);
    setUserImportOpen(false);
    setApiKeyWizardOpen(false);
    setApiKeyWizardInitialValues({});
    setConfirmRestoreModels(false);
    selectView("overview", { replace: true });
    await revokeSession;
  }

  async function saveModal(values: Record<string, string>) {
    if (!modal) return;
    setLoading(true);
    setError("");
    setModalSaveError(null);
    const attempt = createAdminSaveAttempt(api);
    try {
      if (modal.item) {
        await modal.config.update?.(attempt.api, modal.item, values, data);
      } else {
        await modal.config.create?.(attempt.api, values, data);
      }
      attempt.requested = false;
      setModal(null);
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      const message = err instanceof Error ? err.message : tx("保存失败");
      if (attempt.requested && !(modal.config.view === "models" && !modal.item)) setModal(null);
      else setModalSaveError({ state: modal, message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const { saveProjectWorkspace, deleteItem, deleteItems, restoreModelsFromDefaultCatalog, runResourceAction, runToolbarAction, exportReportDataset } = consoleResourceActions({
    api, data, loading, projectWorkspace, load, selectView, setLoading, setError, setNotice,
    setIssuedKey, setProjectWorkspace, setPendingAction, setModal, setApiKeyWizardInitialValues,
    setApiKeyWizardOpen, setConfirmDelete, setConfirmRestoreModels, setUserImportOpen, setReportHistory,
  });

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
      setUserImportOpen(false);
      setError(err instanceof Error ? err.message : tx("用户导入失败"));
    } finally {
      setLoading(false);
    }
  }

  function openCreateRoute(model?: Model) {
    if (!activeConfig) return;
    if (loading) {
      setNotice("");
      setError(tx("数据加载中，请稍后再操作。"));
      return;
    }
    if (data.models.length === 0) {
      setNotice("");
      setError(tx("请先维护模型目录，再新增路由策略。"));
      selectView("models");
      return;
    }
    if (data.providers.length === 0) {
      setNotice("");
      setError(tx("请先新增供应商，再配置路由策略。"));
      selectView("providers");
      return;
    }
    setModal({
      config: model
        ? {
            ...activeConfig,
            title: `${tx("添加线路")} · ${model.name}`,
            fields: activeConfig.fields.filter(field => field.key !== "model_name"),
          }
        : activeConfig,
      initialValues: model ? modelRouteDefaults(model, data) : undefined,
    });
  }

  function openCreateAPIKey() {
    if (loading) {
      setNotice("");
      setError(tx("数据加载中，请稍后再操作。"));
      return;
    }
    setIssuedKey("");
    if (currentUser && appRole(currentUser.role) === "consumer") {
      setQuickAPIKeyOpen(true);
    } else {
      setApiKeyWizardInitialValues({});
      setApiKeyWizardOpen(true);
    }
  }

  function quickCreateAPIKey(values: Record<string, string>, onCreated: () => void) {
    void createKeyWithCapture(api, values, setIssuedKey, setNotice, load, setLoading, setError, onCreated);
  }

  function openCreateForCurrentView() {
    if (!activeConfig) return;
    if (activeView === "routes") {
      openCreateRoute();
      return;
    }
    if (loading) {
      setNotice("");
      setError(tx("数据加载中，请稍后再操作。"));
      return;
    }
    if (activeConfig.view === "providers") {
      setError("");
      setProviderCreateOpen(true);
      return;
    }
    if (activeConfig.view === "projects") {
      setProjectWorkspace({ mode: "create" });
      return;
    }
    if (activeConfig.view === "notification-channels") {
      setModal({ config: activeConfig, initialValues: notificationChannelDefaults(modelCategoryFilter) });
      return;
    }
    if (activeConfig.view === "api-keys") {
      openCreateAPIKey();
      return;
    }
    setModal({ config: activeConfig });
  }

  async function reorderModelRoutes(model: Model, orderedRoutes: ModelRoute[]) {
    setLoading(true);
    setError("");
    setRoutingPolicyError("");
    setNotice("");
    try {
      await adminMutate(api, `/api/admin/model-routing-policies/${encodeURIComponent(model.name)}`, "PATCH", modelRoutePolicyPayload("priority_only", orderedRoutes));
      setNotice(tx(`已更新 ${model.name} 的 Provider 调用顺序`));
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      const message = err instanceof Error ? err.message : tx("更新模型路由策略失败");
      setRoutingPolicyError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const viewItems = activeConfig?.list(data) ?? [];
  const categoryItems = filterByModelCategory(activeConfig?.view, viewItems, modelCategoryFilter, data);
  const filteredItems = activeConfig?.view === "api-keys" ? filterAPIKeys(categoryItems as APIKey[], query) : filterRows(categoryItems, query);
  const crudPagination = usePagination(filteredItems.length, `${activeView}:${modelCategoryFilter}:${query}`);
  const pagedItems = useMemo(() => filteredItems.slice(crudPagination.startIndex, crudPagination.endIndex), [filteredItems, crudPagination.startIndex, crudPagination.endIndex]);
  const workspaceProject = data.projects.find(project => project.id === projectWorkspace?.projectID);

  if (!bootstrapped) {
    return <main className="login-shell" />;
  }

  if (resetToken && !currentUser) {
    return <ResetPasswordView loading={loading} error={error} theme={theme} onThemeToggle={toggleTheme} token={resetToken} onReset={(token, password) => void resetPassword(token, password)} />;
  }

  if (!currentUser) {
    const loginView = (
      <LoginView
        embedded
        loading={loading}
        error={loginError}
        baseURL={baseURL}
        identityProviders={loginIdentityProviders}
        oauthReturnURL={oauthReturnURL}
        theme={theme}
        portal={portal}
        otpLogin={
          pendingLoginOTP
            ? {
                identity: pendingLoginOTP.identity,
                onVerify: verifyLoginOTPPreview,
                onBack: () => {
                  setPendingLoginOTP(null);
                  setLoginError("");
                  setError("");
                },
              }
            : undefined
        }
        onLoginModeChange={() => { setLoginError(""); setError(""); }}
        onThemeToggle={toggleTheme}
        onLogin={(identity, password) => void login(identity, password)}
      />
    );
    return (
      <PortalHome language={language} onLanguageChange={changeLanguage} onThemeToggle={toggleTheme} theme={theme}>
        {loginView}
      </PortalHome>
    );
  }

  async function createTeamMemberAccount(values: PlatformAccountValues) {
    setLoading(true); setError(""); setNotice("");
    try {
      const { project_id } = await createTeamMember(api, values);
      await load("users");
      const name = data.projects.find(item => item.id === project_id)?.name;
      setNotice(tx(name ? `团队成员已创建，并已加入项目空间「${name}」` : `团队成员已创建，并已加入项目空间 ${project_id}`));
      return true;
    } catch (err) {
      if (!isAuthExpiredError(err)) setError(err instanceof Error ? err.message : tx("创建团队成员失败"));
      return false;
    } finally { setLoading(false); }
  }

  async function savePlatformAccount(item: AdminUser | null, values: PlatformAccountValues, doneMessage: string) {
    const config = resourceConfigFor("users") as ResourceConfig<AdminUser>;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (item) {
        await config.update?.(api, item, values);
      } else {
        await config.create?.(api, values, data);
      }
      await load("users");
      setNotice(tx(doneMessage));
      return true;
    } catch (err) {
      if (!isAuthExpiredError(err)) {
        setError(err instanceof Error ? err.message : tx("保存失败"));
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function saveTeamGroup(item: AdminResource | null, values: TeamGroupValues, doneMessage: string) {
    const config = resourceConfigFor("teams") as ResourceConfig<AdminResource>;
    const payload = item ? { ...(config.toForm?.(item) ?? {}), ...values } : values;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (item) {
        await config.update?.(api, item, payload);
      } else {
        await config.create?.(api, payload, data);
      }
      await load("teams");
      setNotice(tx(doneMessage));
      return true;
    } catch (err) {
      if (!isAuthExpiredError(err)) {
        setError(err instanceof Error ? err.message : tx("保存失败"));
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function applyModelRouteStrategy(model: Model, policy: ModelRoutePolicy) {
    const routes = data.routes.filter(route => route.model_name === model.name);
    if (routes.length === 0) return;
    setLoading(true);
    setError("");
    setNotice("");
    let savePending = true;
    try {
      await adminMutate(api, `/api/admin/model-routing-policies/${encodeURIComponent(model.name)}`, "PATCH", policy);
      savePending = false;
      setNotice(tx(`已为 ${model.name} 应用路由策略`));
      await load();
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("应用路由策略失败"));
      if (savePending) return false;
    } finally {
      setLoading(false);
    }
  }

  const isProviderView = activeView === "providers";
  const accountManagementRole = appRole(currentUser.role);
  const isAccountManagementView = activeView === "users" && ["admin", "team_leader"].includes(accountManagementRole);
  const isTeamGroupsView = activeView === "teams" && accountManagementRole === "team_leader";
  const isRoleManagementView = activeView === "settings" && appRole(currentUser.role) === "admin";
  const isMemberAuditView = activeView === "audit" && ["team_leader", "user", "consumer"].includes(accountManagementRole);
  const isMemberGatewayView = activeView === "gateway" && ["user", "consumer"].includes(accountManagementRole);
  const isPersonalAPIKeysView = activeView === "api-keys" && accountManagementRole === "consumer";
  const isTeamResourceView = accountManagementRole === "team_leader" && ["usage", "gateway", "api-keys", "projects"].includes(activeView);
  const isMemberKeyListView = activeView === "api-keys" && accountManagementRole === "user";
  const isPersonalUsageView = activeView === "usage" && ["user", "consumer"].includes(accountManagementRole);
  const isGuestCostView = accountManagementRole === "consumer" && ["billing", "balance-recharge"].includes(activeView);

  return (
    <ModalErrorProvider
      onError={(reason, fallback) => {
        if (!isAuthExpiredError(reason)) setError(reason instanceof Error ? reason.message : fallback);
      }}>
      <main className={`app-shell view-${activeView}${sidebarCollapsed ? " sidebar-collapsed" : ""}`} data-theme={theme}>
        <Sidebar
          activeView={activeView}
          onSelect={selectView}
          user={currentUser}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(value => !value)}
          openGroups={openNavGroups}
          onToggleGroup={title => setOpenNavGroups(current => ({ ...current, [title]: current[title] === false }))}
        />

        <section className="workspace">
          <TopNav
            activeView={activeView}
            api={api}
            data={data}
            user={currentUser}
            theme={theme}
            language={language}
            onLanguageChange={changeLanguage}
            sidebarCollapsed={sidebarCollapsed}
            onSelectView={selectView}
            onThemeToggle={toggleTheme}
            onToggleSidebar={() => setSidebarCollapsed(value => !value)}
            onLogout={() => void logout()}
          />

          {usesSourceAdminContent(currentUser, activeView) ? (
            <SourceAdminContent
              baseURL={baseURL}
              adminToken={adminToken}
              currentUser={currentUser}
              language={language}
              theme={theme}
              onLanguageChange={changeLanguage}
            />
          ) : (
          <div
            className={
              activeView === "playground"
                ? "content-panel playground-content-panel"
                : isGuestCostView
                  ? "content-panel guest-cost-content-panel"
                  : isTeamResourceView || isMemberKeyListView
                    ? "content-panel platform-accounts-content-panel team-resource-content-panel"
                  : isAccountManagementView || isTeamGroupsView || isMemberAuditView || isMemberGatewayView || isPersonalAPIKeysView || isPersonalUsageView
                    ? "content-panel platform-accounts-content-panel"
                    : isRoleManagementView
                      ? "content-panel role-management-content-panel"
                      : "content-panel"
            }>
            {activeView === "playground" ? null : (
              <PageHeader activeView={activeView} data={data} meta={activeMeta} user={currentUser} onSelect={selectView} />
            )}

            <StatusStack error={error} notice={notice} onClearError={() => setError("")} onClearNotice={() => setNotice("")} />

            {activeView === "playground" ||
            isAccountManagementView ||
            isTeamGroupsView ||
            isRoleManagementView ||
            isMemberAuditView ||
            isMemberGatewayView ||
            isPersonalAPIKeysView ||
            isPersonalUsageView ||
            isGuestCostView ? null : (
              <div className="divider" />
            )}

            {activeView === "overview" ? (
              <OverviewView api={api} data={data} user={currentUser} onSelectView={selectView} />
            ) : activeView === "playground" ? (
              <PlaygroundPage
                api={api}
                data={data}
                canViewRoutes={canAccessView(currentUser, "routes")}
                currentUserID={currentUser.id}
                onCreateKey={canAccessView(currentUser, "api-keys") ? () => selectView("api-keys") : undefined}
                personal={accountManagementRole === "consumer"}
                onRecharge={() => selectView("balance-recharge")}
              />
            ) : activeView === "gateway" ? (
              <GatewayView
                api={api}
                data={data}
                user={currentUser}
                language={language}
                onLanguageChange={changeLanguage}
                loading={loading}
                onQuickCreateKey={quickCreateAPIKey}
                onManageKeys={() => selectView("api-keys")}
              />
            ) : activeView === "usage" ? (
              <UsageView api={api} data={data} user={currentUser} />
            ) : activeView === "balance-recharge" && accountManagementRole === "consumer" ? (
              <ConsumerRechargeView api={api} />
            ) : activeView === "billing" ? (
              accountManagementRole === "consumer" ? <GuestCostDetailsView api={api} data={data} /> : <BillingView data={data} user={currentUser} />
            ) : activeView === "audit" ? (
              <AuditView api={api} data={data} user={currentUser} />
            ) : activeView === "database-status" ? (
              <DatabaseStatusView api={api} isDark={theme === "dark"} />
            ) : isRoleManagementView ? (
              <RoleManagementView data={data} loading={loading} onEdit={(config, item) => setModal({ config, item })} onDelete={(config, item) => setConfirmDelete({ config, item })} />
            ) : activeView === "settings" ? (
              <SettingsView
                api={api}
                onRestoreModelCatalog={() => setConfirmRestoreModels(true)}
                data={data}
                activeTab={settingsTab}
                language={language}
                onTabChange={setSettingsTab}
                onLanguageChange={changeLanguage}
                onCreate={config => setModal({ config })}
                onEdit={(config, item) => setModal({ config, item })}
                onDelete={(config, item) => setConfirmDelete({ config, item })}
                onAction={(action, item) => void runResourceAction(action, item, data)}
                onToolbarAction={(action, items) => void runToolbarAction(action, items)}
              />
            ) : activeView === "routes" && activeConfig ? (
              <RouteStrategyView
                onClearError={() => {
                  setError("");
                  setRoutingPolicyError("");
                }}
                error={routingPolicyError}
                config={activeConfig as ResourceConfig<ModelRoute>}
                data={data}
                initialQuery={routeModelQuery}
                loading={loading}
                onCreate={openCreateRoute}
                onOpenModels={() => selectView("models")}
                onOpenProviders={() => selectView("providers")}
                onEdit={route => setModal({ config: activeConfig, item: route })}
                onDelete={route => setConfirmDelete({ config: activeConfig, item: route })}
                onReorder={(model, routes) => void reorderModelRoutes(model, routes)}
                onSavePolicy={applyModelRouteStrategy}
              />
            ) : activeView === "models" && activeConfig ? (
              <ModelDirectoryView
                api={api}
                config={activeConfig as ResourceConfig<Model>}
                data={data}
                loading={loading}
                role={appRole(currentUser.role)}
                readOnly={!canAccessView(currentUser, "routes")}
                onReload={() => load("models")}
                onCreateModel={() => setModal({ config: activeConfig })}
                onEditModel={item => setModal({ config: activeConfig, item })}
                onDeleteModel={item => setConfirmDelete({ config: activeConfig, item })}
                onOpenProviders={() => selectView("providers")}
                onOpenRoutes={openRoutes}
              />
            ) : activeView === "reports" && activeConfig ? (
              <ReportsView
                config={activeConfig as ResourceConfig<AdminResource>}
                data={data}
                history={reportHistory}
                loading={loading}
                onCreate={() => setModal({ config: activeConfig })}
                onEdit={item => setModal({ config: activeConfig, item })}
                onDelete={item => setConfirmDelete({ config: activeConfig, item })}
                onAction={(action, item) => void runResourceAction(action, item, data)}
                onExport={dataset => void exportReportDataset(dataset)}
              />
            ) : isProviderView && activeConfig ? (
              <ProviderChannelView
                api={api}
                config={activeConfig as ResourceConfig<Provider>}
                currentUser={currentUser}
                user={currentUser}
                data={data}
                items={pagedItems as Provider[]}
                monitorItems={filteredItems as Provider[]}
                loading={loading}
                pagination={crudPagination}
                categoryFilter={modelCategoryFilter}
                onCategoryFilter={setModelCategoryFilter}
                query={query}
                totalItems={filteredItems.length}
                onAction={(action, item) => void runResourceAction(action, item, data)}
                onCreate={openCreateForCurrentView}
                onDelete={item => setConfirmDelete({ config: activeConfig, item })}
                onEdit={setProviderEditItem}
                onQuery={setQuery}
                onToolbarAction={action => void runToolbarAction(action, filteredItems)}
              />
            ) : isAccountManagementView && activeConfig ? (
              <PlatformAccountsView
                variant={accountManagementRole === "team_leader" ? "team" : "platform"}
                currentUser={currentUser}
                data={data}
                loading={loading}
                onCreate={values => accountManagementRole === "team_leader"
                  ? createTeamMemberAccount(values)
                  : savePlatformAccount(null, values, "用户新增成功")}
                onDelete={item => setConfirmDelete({ config: activeConfig, item })}
                onEdit={(item, values) => savePlatformAccount(item, values, "用户信息已更新")}
                onOnboard={async values => {
                  setLoading(true); setError(""); setNotice("");
                  try { await createCustomerOnboarding(api, values); await load("users"); setNotice(tx("客户开通成功")); return true; }
                  catch (err) { if (!isAuthExpiredError(err)) setError(err instanceof Error ? err.message : tx("客户开通失败，请检查后重试")); return false; }
                  finally { setLoading(false); }
                }}
                onResetPassword={(item, values) => savePlatformAccount(item, values, "密码已重置")}
                onToggleStatus={async item => {
                  const values = {
                    ...(activeConfig.toForm?.(item) ?? {}),
                    status: ["active", "enabled", "healthy"].includes(item.status.toLowerCase()) ? "disabled" : "active",
                  };
                  await savePlatformAccount(item, values, values.status === "active" ? "账号已启用" : "账号已禁用");
                }}
              />
            ) : isTeamGroupsView && activeConfig ? (
              <TeamGroupsView
                data={data}
                loading={loading}
                onCreate={values => saveTeamGroup(null, values, "团队分组新增成功")}
                onDelete={item => setConfirmDelete({ config: activeConfig, item })}
                onEdit={(item, values) => saveTeamGroup(item, values, "团队分组已更新")}
                onToggleStatus={async item => {
                  const status = ["active", "enabled", "healthy"].includes(item.status.toLowerCase()) ? "disabled" : "active";
                  await saveTeamGroup(item, { status }, status === "active" ? "团队分组已启用" : "团队分组已禁用");
                }}
              />
            ) : activeView === "api-keys" && apiKeyUsageID ? (
              <APIKeyUsageView api={api} data={data} user={currentUser} keyID={apiKeyUsageID} onBack={() => selectView("api-keys")} />
            ) : isPersonalAPIKeysView && activeConfig ? (
              <PersonalAPIKeysView
                keys={data.keys}
                loading={loading}
                onCreate={openCreateAPIKey}
                onDelete={item => setConfirmDelete({ config: activeConfig, item })}
                onToggleStatus={item => {
                  const status = ["active", "enabled", "healthy"].includes(item.status.toLowerCase()) ? "disabled" : "active";
                  void runResourceAction(apiKeyStatusAction(status), item, data);
                }}
              />
            ) : activeConfig ? (
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
                onEdit={item => {
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
                onDelete={item => setConfirmDelete({ config: activeConfig, item })}
                onAction={(action, item) => void runResourceAction(action, item, data)}
                onProjectOpen={project => setProjectWorkspace({ mode: "view", projectID: project.id })}
                onToolbarAction={action => void runToolbarAction(action, filteredItems)}
              />
            ) : null}
          </div>
          )}
        </section>

        {projectWorkspace && (!projectWorkspace.projectID || workspaceProject) ? (
          <ProjectWorkspace
            mode={projectWorkspace.mode}
            data={data}
            project={workspaceProject}
            loading={loading}
            onClose={() => { if (!loading) setProjectWorkspace(null); }}
            onEdit={() => setProjectWorkspace(current => current ? { ...current, mode: "edit" } : current)}
            onSave={draft => void saveProjectWorkspace(draft)}
            onIssueKey={() => {
              if (!workspaceProject) return;
              setIssuedKey("");
              setApiKeyWizardInitialValues({ project_id: workspaceProject.id, name: `${workspaceProject.name} Key` });
              setApiKeyWizardOpen(true);
            }}
            onAction={action => { if (workspaceProject) void runResourceAction(action, workspaceProject, data); }}
            onCreateMember={() => { if (workspaceProject) setModal({ config: projectMemberConfig(), initialValues: projectMemberInitialValues(workspaceProject) }); }}
            onEditMember={member => setModal({ config: projectMemberConfig(), item: member })}
            onDeleteMember={member => setConfirmDelete({ config: projectMemberConfig(), item: member })}
          />
        ) : null}

        {modal && String(modal.config.view) === "role-configs" ? (
          <RoleManagementEditModal state={modal} loading={loading} onClose={() => setModal(null)} onSave={values => void saveModal(values)} />
        ) : modal ? (
          <EditModal
            api={api}
            state={modal}
            error={modalSaveError?.state === modal ? modalSaveError.message : ""}
            data={data}
            currentUser={currentUser}
            loading={loading}
            onClose={() => setModal(null)}
            onSave={values => {
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
            providerTypeOptions={providerTypeOptions}
            providerAdapters={data.providerAdapters}
            plugins={data.plugins}
            pluginUI={data.pluginUI}
            pluginActions={data.pluginActions}
            resources={data.providerResources}
            loading={loading}
            onClose={() => setProviderCreateOpen(false)}
            onSaved={async () => {
              setProviderCreateOpen(false);
              await load();
            }}
            setLoading={setLoading}
            error={error}
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
            providerTypeOptions={providerTypeOptions}
            providerAdapters={data.providerAdapters}
            plugins={data.plugins}
            pluginUI={data.pluginUI}
            pluginActions={data.pluginActions}
            routes={data.routes}
            resources={data.providerResources.filter(resource => resource.provider_id === providerEditItem.id)}
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
            error={error}
            setError={setError}
            setNotice={setNotice}
          />
        ) : null}

        {quickAPIKeyOpen ? (
          <QuickAPIKeyModal
            data={data}
            user={currentUser}
            loading={loading}
            onClose={() => {
              if (!loading) setQuickAPIKeyOpen(false);
            }}
            onCreate={values => quickCreateAPIKey(values, () => setQuickAPIKeyOpen(false))}
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
            onCreate={values => {
              setIssuedKey("");
              void createKeyWithCapture(api, values, setIssuedKey, setNotice, load, setLoading, setError, () => {
                setApiKeyWizardOpen(false);
                setApiKeyWizardInitialValues({});
              });
            }}
          />
        ) : null}

        {userImportOpen ? <UserImportModal loading={loading} onClose={() => setUserImportOpen(false)} onImport={content => void importUsersFromCSV(content)} /> : null}

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
            title={tx("恢复出厂目录")}
            message={tx("将从配置文件重新导入标准模型，并覆盖同名模型的目录字段；手动新增的其他模型会保留。")}
            confirmLabel="恢复"
            confirmClassName="button"
            loading={loading}
            onCancel={() => setConfirmRestoreModels(false)}
            onConfirm={() => void restoreModelsFromDefaultCatalog()}
          />
        ) : null}

        {pendingAction?.action.confirmation ? <ConfirmDialog
          title={pendingAction.action.confirmation.title}
          message={pendingAction.action.confirmation.message(pendingAction.item)}
          confirmLabel={pendingAction.action.confirmation.confirmLabel}
          loading={loading}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => { const pending = pendingAction; setPendingAction(null); void runResourceAction(pending.action, pending.item, data, true); }}
        /> : null}
        {usesSourceAdminContent(currentUser, activeView) ? null : accountManagementRole === "consumer"
          ? issuedKey ? <IssuedKeyModal value={issuedKey} onClose={() => setIssuedKey("")} /> : null
          : !usesSourceAdminContent(currentUser, activeView) && <APIKeyAccessDialogs key={currentUser.id} baseURL={api.baseURL} issuedKey={issuedKey} onCloseIssuedKey={() => setIssuedKey("")} />}
      </main>
    </ModalErrorProvider>
  );
}

function normalizeUsageBreakdown(raw: Partial<UsageBreakdown> | null | undefined): UsageBreakdown {
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return { ...raw, projects: list(raw?.projects), models: list(raw?.models), members: list(raw?.members), providers: list(raw?.providers), provider_resources: list(raw?.provider_resources), cost_centers: list(raw?.cost_centers), api_keys: list(raw?.api_keys) };
}
