import { useCustomerTerminology } from "../i18n/customer-copy";
import { deploymentPath } from "@/lib/deployment-path";
import { AlertCircle, Check, ChevronDown, ChevronRight, LogOut, Moon, Search, Sun, Wallet, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { SvgIcon } from "@/components/svg-icon";
import {
  appRole,
  filterNavItemByAccess,
  isNavItemActive,
  isNavParentItem,
  navGroupsForUser,
  normalizeSearchText,
  readRecentViews,
  roleScopeDescription,
  standaloneViewMeta,
  topQuickActionsForUser,
  topSearchItemsForUser,
  topSearchResults,
} from "../core/navigation";
import { type AdminUser, type ApiContext, type AppData, type NavItem, type ViewKey } from "../core/types";
import { formatMoney, formatNumber, playgroundModels } from "../domain/formatting";
import { userInitial } from "../domain/labels";
import { LanguageSelect } from "../i18n/language-switcher";
import { type AppLanguage, displayText, tx } from "../i18n/runtime";
import { resourceConfigFor } from "../resources/settings-config";
import { BalanceCard } from "./balance-card";
import { SidebarNavItem } from "./sidebar-nav-item";

export function Sidebar({
  activeView,
  onSelect,
  user,
  collapsed,
  onToggleCollapse,
  openGroups,
  onToggleGroup,
}: {
  activeView: ViewKey;
  onSelect: (view: ViewKey) => void;
  user: AdminUser;
  collapsed: boolean;
  onToggleCollapse: () => void;
  openGroups: Record<string, boolean>;
  onToggleGroup: (title: string) => void;
}) {
  const ui = useCustomerTerminology();
  const visibleGroups = navGroupsForUser(user)
    .map(group => ({ ...group, items: group.items.map(item => filterNavItemByAccess(item, user)).filter((item): item is NavItem => Boolean(item)) }))
    .filter(group => group.items.length > 0);
  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="brand">
        <img alt="" className="brand-logo" src={deploymentPath("/brand/tokencube-logo.svg")} />
        <span className="brand-name">TokenStation</span>
        <button className="sidebar-toggle" aria-label={collapsed ? tx("展开菜单") : tx("折叠菜单")} onClick={onToggleCollapse} title={collapsed ? tx("展开菜单") : tx("折叠菜单")} type="button">
          <SvgIcon name="ApplicationMenuOutlined" size={16} />
        </button>
      </div>
      <div className="sidebar-nav-scroll">
        {visibleGroups.map(group => {
          const groupOpen = collapsed || openGroups[group.title] !== false;
          return (
            <div className={groupOpen ? "nav-group" : "nav-group closed"} key={group.title}>
              <button aria-expanded={groupOpen} aria-hidden={collapsed || undefined} tabIndex={collapsed ? -1 : undefined} className={groupOpen ? "nav-title" : "nav-title closed"} onClick={() => onToggleGroup(group.title)} title={collapsed ? undefined : tx(groupOpen ? "点击收起" : "点击展开")} type="button">
                <span className="nav-title-label">
                  <span>{ui(group.title)}</span>
                </span>
                <ChevronDown className="nav-chevron" size={14} />
              </button>
              {groupOpen ? (
                <div className="nav">
                  {group.items.map(item => {
                    const Icon = item.icon;
                    if (isNavParentItem(item)) {
                      if (collapsed) {
                        return item.children.map(child => {
                          const ChildIcon = child.icon;
                          return (
                            <SidebarNavItem active={activeView === child.view} collapsed={collapsed} label={ui(child.label)} key={child.view} onSelect={() => onSelect(child.view)}>
                              <ChildIcon size={16} />
                            </SidebarNavItem>
                          );
                        });
                      }
                      const childOpen = openGroups[`nav:${item.label}`] !== false || isNavItemActive(item, activeView);
                      return (
                        <div className={childOpen ? "nav-branch" : "nav-branch closed"} key={item.label}>
                          <button
                            aria-expanded={childOpen}
                            className={isNavItemActive(item, activeView) ? "nav-item nav-parent active-parent" : "nav-item nav-parent"}
                            onClick={() => onToggleGroup(`nav:${item.label}`)}
                            type="button">
                            <Icon size={16} />
                            <span>{ui(item.label)}</span>
                            <ChevronDown className="nav-chevron" size={14} />
                          </button>
                          {childOpen ? (
                            <div className="nav-subnav">
                              {item.children.map(child => {
                                const ChildIcon = child.icon;
                                return (
                                  <button
                                    className={activeView === child.view ? "nav-item nav-child active" : "nav-item nav-child"}
                                    key={child.view}
                                    onClick={() => onSelect(child.view)}
                                    type="button">
                                    <ChildIcon size={16} />
                                    <span>{ui(child.label)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    }
                    return (
                      <SidebarNavItem
                        active={activeView === item.view}
                        collapsed={collapsed}
                        label={ui(item.label)}
                        key={item.view}
                        onSelect={() => onSelect(item.view)}>
                        <Icon size={16} />
                      </SidebarNavItem>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function PageHeader({ activeView, data, meta, user, onSelect }: { activeView: ViewKey; data: AppData; meta: { title: string; description: string; eyebrow?: string }; user: AdminUser; onSelect?: (view: ViewKey) => void }) {
  const ui = useCustomerTerminology();
  const path = navPathForView(user, activeView);
  const chips = pageHeaderChips(activeView, data, user);
  const pathGroup = path.group || pageHeaderFallbackGroup(activeView, user);
  const crumbs: { label: string; view?: ViewKey }[] = [{ label: "TokenStation", view: "overview" }];
  if (pathGroup) crumbs.push({ label: pathGroup });
  if (path.parent) crumbs.push({ label: path.parent });
  crumbs.push({ label: path.label || meta.title });
  return (
    <header className="page-header page-context-header">
      <div className="page-context-main">
        <nav className="page-breadcrumb" aria-label={tx("当前位置")}>
          {crumbs.map((crumb, index) => {
            const current = index === crumbs.length - 1;
            const target = crumb.view;
            return (
              <Fragment key={`${crumb.label}-${index}`}>
                {index > 0 ? <ChevronRight aria-hidden="true" className="page-breadcrumb-separator" size={13} /> : null}
                {target && onSelect && !current ? (
                  <button type="button" onClick={() => onSelect(target)}>{ui(crumb.label)}</button>
                ) : (
                  <span className={current ? "current" : undefined} aria-current={current ? "page" : undefined}>{ui(crumb.label)}</span>
                )}
              </Fragment>
            );
          })}
        </nav>
      </div>
      <div className="page-context-side">
        <span className="scope-chip">{ui(roleScopeDescription(user))}</span>
        {chips.map(chip => (
          <span className="page-context-chip" key={chip.label}>
            <strong>{chip.value}</strong>
            <em>{ui(chip.label)}</em>
          </span>
        ))}
      </div>
    </header>
  );
}

export function StatusStack({ error, notice, onClearError, onClearNotice }: { error: string; notice: string; onClearError: () => void; onClearNotice: () => void }) {
  const ui = useCustomerTerminology();
  if (!error && !notice) return null;
  return (
    <div className="status-stack">
      {error ? (
        <div className="status-line error">
          <AlertCircle size={16} />
          <span>{ui(error)}</span>
          <button className="icon-button subtle" onClick={onClearError} title={tx("关闭")} type="button">
            <X size={14} />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="status-line success">
          <Check size={16} />
          <span>{ui(notice)}</span>
          <button className="icon-button subtle" onClick={onClearNotice} title={tx("关闭")} type="button">
            <X size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function navPathForView(user: AdminUser, view: ViewKey) {
  for (const group of navGroupsForUser(user)) {
    for (const item of group.items) {
      const filtered = filterNavItemByAccess(item, user);
      if (!filtered) continue;
      if (isNavParentItem(filtered)) {
        const child = filtered.children.find(entry => entry.view === view);
        if (child) return { group: group.title, parent: filtered.label, label: child.label };
      } else if (filtered.view === view) {
        return { group: group.title, parent: "", label: filtered.label };
      }
    }
  }
  return { group: "", parent: "", label: standaloneViewMeta[view]?.title ?? view };
}

export function pageHeaderFallbackGroup(view: ViewKey, user: AdminUser) {
  if (view === "gateway") {
    const role = appRole(user.role);
    if (role === "team_leader") return "团队管理";
    if (role === "user" || role === "consumer") return "开始使用";
    return "接入参考";
  }
  return "";
}

export function pageHeaderChips(view: ViewKey, data: AppData, user: AdminUser) {
  const role = appRole(user.role);
  switch (view) {
    case "providers":
      return [
        { label: "已启用供应商", value: `${formatNumber(data.providers.filter((item) => item.status === "active").length)}/${formatNumber(data.providers.length)}` },
        { label: "资源实例", value: formatNumber(data.providerResources.length) },
      ];
    case "models":
      return [
        { label: "可用模型", value: formatNumber(playgroundModels(data).length || data.models.length) },
        { label: "启用路由", value: formatNumber(data.summary.active_route_count || data.routes.filter(item => item.status === "active").length) },
      ];
    case "routes":
      return [
        { label: "启用路由", value: formatNumber(data.routes.filter(item => item.status === "active").length) },
        { label: "Provider", value: formatNumber(data.providers.length) },
      ];
    case "projects":
      return [
        { label: "项目", value: formatNumber(data.projects.length) },
        { label: role === "team_leader" ? "团队成员" : "用户", value: formatNumber(data.users.length) },
      ];
    case "api-keys":
      if (role === "user" || role === "consumer") {
        return [
          { label: "Key", value: formatNumber(data.keys.length) },
          { label: "可用模型", value: formatNumber(playgroundModels(data).length) },
        ];
      }
      return [
        { label: "Key", value: formatNumber(data.keys.length) },
        { label: "项目", value: formatNumber(data.projects.length) },
      ];
    case "gateway":
      if (role === "user" || role === "consumer" || role === "team_leader") {
        return [
          { label: "API Key", value: formatNumber(data.keys.length) },
          { label: "可用模型", value: formatNumber(playgroundModels(data).length) },
        ];
      }
      return [{ label: "记录", value: formatNumber(pageRecordCount(view, data)) }];
    case "settings": {
      const currentSettings = data.resources.settings?.find(item => item.id === "cfg_gateway") ?? data.resources.settings?.[0];
      return [{ label: "当前生效", value: currentSettings?.id ?? "-" }];
    }
    case "usage":
      return [];
    case "billing":
      return [
        { label: "请求", value: formatNumber(data.summary.request_count) },
        { label: "成本", value: `$${formatMoney(data.summary.estimated_cost_usd)}` },
      ];
    case "audit":
      return [
        { label: "请求日志", value: formatNumber(data.logs.length) },
        { label: "错误请求", value: formatNumber(data.summary.errors) },
      ];
    default:
      return [{ label: "记录", value: formatNumber(pageRecordCount(view, data)) }];
  }
}

export function pageRecordCount(view: ViewKey, data: AppData) {
  const config = resourceConfigFor(view);
  if (config) return config.list(data).length;
  if (view === "alert-events") return data.alerts.length;
  if (view === "alert-deliveries") return data.alertDeliveries.length;
  if (view === "approvals") return data.approvals.length;
  return 0;
}

type TopNavProps = {
  activeView: ViewKey;
  api: ApiContext;
  data: AppData;
  user: AdminUser;
  theme: "light" | "dark";
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  sidebarCollapsed: boolean;
  onSelectView: (view: ViewKey) => void;
  onThemeToggle: () => void;
  onToggleSidebar: () => void;
  onLogout: () => void;
};

export function TopNav(props: TopNavProps) {
  return <ConsoleTopNav {...props} />;
}

function ConsoleTopNav({ activeView, api, user, theme, language, sidebarCollapsed, onLanguageChange, onSelectView, onThemeToggle, onToggleSidebar, onLogout }: TopNavProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const isGuest = appRole(user.role) === "consumer";
  const accountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function closeAccount(event: MouseEvent) {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    }
    window.addEventListener("mousedown", closeAccount);
    return () => window.removeEventListener("mousedown", closeAccount);
  }, []);

  return (
    <header className="topbar console-topbar">
      <button
        aria-label={sidebarCollapsed ? tx("展开菜单") : tx("折叠菜单")}
        className="console-topbar-menu"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? tx("展开菜单") : tx("折叠菜单")}
        type="button">
        <SvgIcon name="ApplicationMenuOutlined" size={16} />
      </button>
      <div className="console-topbar-spacer" />
      {/* <button
        aria-label={tx("告警事件")}
        className={activeView === "alert-events" ? "console-topbar-icon active" : "console-topbar-icon"}
        onClick={() => onSelectView("alert-events")}
        title={tx("告警事件")}
        type="button">
        <Bell size={17} />
      </button> */}
      <LanguageSelect className="console-topbar-language" language={language} onChange={onLanguageChange} />
      <button
        aria-label={theme === "dark" ? tx("切换到浅色模式") : tx("切换到深色模式")}
        className="console-topbar-icon"
        onClick={onThemeToggle}
        title={theme === "dark" ? tx("切换到浅色模式") : tx("切换到深色模式")}
        type="button">
        {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      {isGuest || appRole(user.role) === "team_leader" ? <BalanceCard activeView={activeView} api={api} teamID={appRole(user.role) === "team_leader" ? user.team_id : undefined} onSelectView={onSelectView} /> : null}
      <div className="console-topbar-account" ref={accountRef}>
        <button aria-expanded={accountOpen} aria-haspopup="menu" aria-label={tx("个人中心")} className="console-topbar-account-trigger" onClick={() => setAccountOpen(value => !value)} type="button">
          <span className="console-topbar-avatar">{userInitial(user)}</span>
          <span className="console-topbar-identity">
            <strong>{displayText(user.name) || user.username}</strong>
          </span>
          <ChevronDown className={accountOpen ? "open" : ""} size={14} />
        </button>
        {accountOpen ? (
          <div className="console-account-menu" role="menu" aria-label={tx("个人中心")}>
            <div className="console-account-menu-profile">
              <span className="console-topbar-avatar">{userInitial(user)}</span>
              <span className="console-topbar-identity">
                <strong>{user.username}</strong>
                {user.email ? <small>{user.email}</small> : null}
              </span>
            </div>
            {isGuest ? (
              <a href={deploymentPath("/balance-recharge/")} role="menuitem">
                <Wallet size={15} />
                <span>{tx("余额充值")}</span>
              </a>
            ) : null}
            <button onClick={onLogout} role="menuitem" type="button">
              <LogOut size={15} />
              <span>{tx("退出登录")}</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function StandardTopNav({ activeView, data, user, theme, onSelectView, onThemeToggle }: TopNavProps) {
  const ui = useCustomerTerminology();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recentViews, setRecentViews] = useState<ViewKey[]>(() => readRecentViews());
  const searchItems = topSearchItemsForUser(user, data);
  const normalizedQuery = normalizeSearchText(query);
  const results = topSearchResults(searchItems, appRole(user.role), normalizedQuery, recentViews);
  const showResults = open && (query.trim().length > 0 || results.length > 0);
  const quickActions = topQuickActionsForUser(user);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    setRecentViews(readRecentViews());
  }, [activeView]);

  function openResult(view: ViewKey) {
    setQuery("");
    setOpen(false);
    onSelectView(view);
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      openResult(results[0].view);
    }
  }

  return (
    <header className="topbar">
      <div className="top-search-wrap">
        <label className={showResults ? "top-search active" : "top-search"} aria-label={tx("搜索控制台")}>
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onChange={event => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleSearchKeyDown}
            placeholder={tx("搜索模型、Provider、日志...")}
          />
          <span>⌘K</span>
        </label>
        {showResults ? (
          <div className="top-search-panel" role="listbox" aria-label={tx("搜索结果")} onMouseDown={event => event.preventDefault()}>
            {results.length > 0 ? (
              results.map(item => {
                const Icon = item.icon;
                return (
                  <button
                    className={item.view === activeView ? "top-search-result active" : "top-search-result"}
                    key={item.id}
                    onClick={() => openResult(item.view)}
                    role="option"
                    type="button"
                    aria-selected={item.view === activeView}>
                    <span className={`top-search-result-icon ${item.tone ?? "page"}`}>
                      <Icon size={16} />
                    </span>
                    <span className="top-search-result-body">
                      <strong>{ui(item.label)}</strong>
                      <small>
                        {tx(item.group)} · {tx(item.description)}
                      </small>
                    </span>
                    <span className="top-search-result-action">{tx("打开")}</span>
                  </button>
                );
              })
            ) : (
              <div className="top-search-empty">
                <strong>{tx("没有找到匹配入口")}</strong>
                <span>{tx("请尝试搜索模型、Key、用量、日志或设置。")}</span>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <div className="top-quick-actions" aria-label={tx("常用操作")}>
          {quickActions.map(item => {
            const Icon = item.icon;
            return (
              <button className={item.view === activeView ? "top-icon-button active" : "top-icon-button"} key={item.view} onClick={() => openResult(item.view)} title={ui(item.label)} type="button">
                <Icon size={17} />
              </button>
            );
          })}
        </div>
        <button className="top-icon-button" onClick={onThemeToggle} title={tx("切换主题")} type="button">
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
        </button>
      </div>
    </header>
  );
}
