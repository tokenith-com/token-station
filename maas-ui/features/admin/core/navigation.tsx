import { Activity, AlertCircle, BarChart3, Bell, Boxes, CreditCard, Database, FileText, Gauge, KeyRound, LayoutDashboard, Puzzle, Send, Server, Settings, ShieldCheck, Sparkles, Users, WalletCards } from "lucide-react";
import { type AdminUser, type AppData, type AppRole, type NavItem, type NavLeafItem, type NavParentItem, recentViewsStorageKey, type TopSearchItem, type ViewKey, viewRoutes } from "./types";
import { modelCapabilitySummary } from "../domain/entities";
import { tx } from "../i18n/runtime";

export type NavGroup = {
  title: string;
  icon?: typeof Activity;
  items: NavItem[];
};

export const userNavGroups: NavGroup[] = [
  {
    title: "开始使用",
    items: [
      { view: "overview", label: "总览", icon: LayoutDashboard },
    ],
  },
  {
    title: "我的资源",
    items: [
      { view: "models", label: "可用模型", icon: Boxes },
      { view: "playground", label: "模型演练场", icon: Send },
      { view: "api-keys", label: "Key管理", icon: KeyRound },
      { view: "gateway", label: "接口文档", icon: Sparkles },
    ],
  },
  {
    title: "我的用量",
    items: [
      { view: "usage", label: "用量统计", icon: BarChart3 },
      { view: "audit", label: "请求日志", icon: FileText },
    ],
  },
];

export const guestNavGroups: NavGroup[] = [
  ...userNavGroups,
  {
    title: "成本管理",
    items: [
      { view: "billing", label: "费用明细", icon: FileText },
      { view: "balance-recharge", label: "余额充值", icon: CreditCard },
    ],
  },
];

export const teamLeaderNavGroups: NavGroup[] = [
  {
    title: "工作台",
    icon: LayoutDashboard,
    items: [
      { view: "overview", label: "团队总览", icon: LayoutDashboard },
      { view: "usage", label: "团队报表", icon: BarChart3 },
    ],
  },
  {
    title: "AI资源",
    icon: Boxes,
    items: [
      { view: "models", label: "可用模型", icon: Boxes },
      { view: "api-keys", label: "Key 管理", icon: KeyRound },
      { view: "gateway", label: "接口文档", icon: Sparkles },
    ],
  },
  {
    title: "团队管理",
    icon: Users,
    items: [
      { view: "projects", label: "项目空间", icon: Boxes },
      { view: "users", label: "团队成员", icon: Users },
      { view: "audit", label: "请求日志", icon: FileText },
    ],
  },
];

export const adminNavGroups: NavGroup[] = [
  {
    title: "工作台",
    icon: LayoutDashboard,
    items: [
      { view: "overview", label: "平台总览", icon: LayoutDashboard },
      { view: "usage", label: "全局用量", icon: BarChart3 },
      { view: "audit", label: "请求日志", icon: FileText },
      { view: "reports", label: "导出报表", icon: BarChart3 },
    ],
  },
  {
    title: "AI资源",
    icon: Boxes,
    items: [
      { view: "providers", label: "供应商", icon: Server },
      { view: "models", label: "模型目录", icon: Boxes },
      { view: "routes", label: "路由策略", icon: Gauge },
      { view: "playground", label: "模型演练场", icon: Send },
      { view: "routing-policies", label: "作用域策略", icon: ShieldCheck },
    ],
  },
  {
    title: "组织治理",
    icon: Users,
    items: [
      { view: "projects", label: "项目空间", icon: LayoutDashboard },
      { view: "api-keys", label: "Key 管理", icon: KeyRound },
      { view: "teams", label: "团队分组", icon: Users },
      { view: "approvals", label: "审批记录", icon: ShieldCheck },
    ],
  },
  {
    title: "成本治理",
    icon: WalletCards,
    items: [
      { view: "billing", label: "成本账单", icon: WalletCards },
      { view: "quota-policies", label: "额度策略", icon: Gauge },
      { view: "cost-centers", label: "成本中心", icon: Database },
    ],
  },
  {
    title: "健康与告警",
    icon: Activity,
    items: [
      { view: "monitors", label: "健康检测", icon: Activity },
      { view: "alerts", label: "告警规则", icon: AlertCircle },
      { view: "alert-events", label: "告警事件", icon: AlertCircle },
      { view: "notification-channels", label: "通知渠道", icon: Bell },
      { view: "alert-deliveries", label: "通知记录", icon: Bell },
    ],
  },
  {
    title: "安全运维",
    icon: ShieldCheck,
    items: [
      { view: "security-policies", label: "安全策略", icon: ShieldCheck },
      { view: "sqlite-backups", label: "数据备份", icon: Database },
      { view: "database-status", label: "数据库状态", icon: Database },
      { view: "announcements", label: "公告通知", icon: Bell },
      { view: "plugins", label: "插件管理", icon: Puzzle },
    ],
  },
  {
    title: "系统设置",
    icon: Settings,
    items: [
      { view: "users", label: "平台账号", icon: Users },
      { view: "role-configs", label: "角色配置", icon: ShieldCheck },
      { view: "identity-providers", label: "身份源", icon: KeyRound },
      { view: "settings", label: "基础设置", icon: Settings },
    ],
  },
];

export const navGroupsByRole: Record<AppRole, NavGroup[]> = {
  admin: adminNavGroups,
  team_leader: teamLeaderNavGroups,
  user: userNavGroups,
  guest: guestNavGroups,
};

export const allNavGroupTitles = Array.from(new Set(Object.values(navGroupsByRole).flatMap(groups => groups.map(group => group.title))));

export const standaloneViewMeta: Partial<Record<ViewKey, { title: string; description: string }>> = {
  overview: {
    title: "网关概览",
    description: "",
  },
  playground: {
    title: "模型演练场",
    description: "选择标准模型，按当前路由策略发起测试对话，验证 Provider、路由和返回内容。",
  },
  gateway: {
    title: "接口文档",
    description: "面向业务开发者的模型 API 调用说明、认证方式、示例代码和错误排查。",
  },
  usage: {
    title: "用量统计",
    description: "按模型、项目和日期查看请求量、Token 和成本归因。",
  },
  billing: {
    title: "费用明细",
    description: "按 Provider 和项目归集估算成本，辅助成本分摊。",
  },
  "balance-recharge": {
    title: "余额充值",
    description: "",
  },
  audit: {
    title: "请求日志",
    description: "查看最近请求日志、状态码、模型路由和延迟。",
  },
  "alert-events": {
    title: "告警事件",
    description: "查看运行时触发的额度、成本和 Provider 健康告警。",
  },
  "alert-deliveries": {
    title: "通知记录",
    description: "查看告警 Webhook 发送结果、目标和失败原因。",
  },
  "database-status": {
    title: "数据库状态",
    description: "查看数据库类型、连接状态和运行环境信息。",
  },
  approvals: {
    title: "审批记录",
    description: "处理 Key 发放、额度提升和模型开通等治理审批。",
  },
};

export const roleViewAccess: Record<AppRole, ViewKey[]> = {
  admin: (Object.keys(viewRoutes) as ViewKey[]).filter(
    (view) => !["project-members", "approval-flows", "balance-recharge"].includes(view),
  ),
  team_leader: ["overview", "gateway", "playground", "models", "projects", "api-keys", "teams", "users", "usage", "billing", "audit", "approvals"],
  user: ["overview", "gateway", "playground", "models", "api-keys", "usage", "audit"],
  guest: ["overview", "gateway", "playground", "models", "api-keys", "usage", "audit", "billing", "balance-recharge"],
};

export function appRole(role: string): AppRole {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "admin" || normalized === "system_admin") return "admin";
  if (normalized === "team_leader" || normalized === "teamlead" || normalized === "project_admin") return "team_leader";
  if (["guest", "individual", "consumer", "retail_user"].includes(normalized)) return "guest";
  return "user";
}

export function canAccessView(user: AdminUser, view: ViewKey) {
  return roleViewAccess[appRole(user.role)].includes(view);
}

export function navGroupsForUser(user: AdminUser) {
  return navGroupsByRole[appRole(user.role)];
}

export function isNavParentItem(item: NavItem): item is NavParentItem {
  return "children" in item;
}

export function filterNavItemByAccess(item: NavItem, user: AdminUser): NavItem | null {
  if (isNavParentItem(item)) {
    const children = item.children.filter((child) => canAccessView(user, child.view));
    return children.length > 0 ? { ...item, children } : null;
  }
  return canAccessView(user, item.view) ? item : null;
}

export function isNavItemActive(item: NavItem, activeView: ViewKey) {
  if (isNavParentItem(item)) {
    return item.children.some((child) => child.view === activeView);
  }
  return item.view === activeView;
}

export function canViewAdminAudit(user: AdminUser) {
  return appRole(user.role) === "admin";
}

export function defaultViewForRole(user: AdminUser): ViewKey {
  return roleViewAccess[appRole(user.role)][0] ?? "overview";
}

export const topSearchPreferredViews: Record<AppRole, ViewKey[]> = {
  admin: ["overview", "providers", "routes", "models", "projects", "api-keys", "usage", "settings"],
  team_leader: ["overview", "projects", "api-keys", "usage", "billing", "gateway"],
  user: ["overview", "gateway", "playground", "models", "api-keys", "usage"],
  guest: ["overview", "gateway", "models", "playground", "api-keys", "usage", "billing"],
};

export function topSearchItemsForUser(user: AdminUser, data: AppData): TopSearchItem[] {
  const seen = new Set<ViewKey>();
  const items: TopSearchItem[] = [];
  for (const group of navGroupsForUser(user)) {
    for (const item of group.items) {
      const filtered = filterNavItemByAccess(item, user);
      if (!filtered) continue;
      if (isNavParentItem(filtered)) {
        for (const child of filtered.children) {
          addTopSearchItem(items, seen, child, `${group.title} / ${filtered.label}`);
        }
        continue;
      }
      addTopSearchItem(items, seen, filtered, group.title);
    }
  }
  return [...items, ...topSearchEntityItems(user, data)];
}

export function addTopSearchItem(items: TopSearchItem[], seen: Set<ViewKey>, item: NavLeafItem, group: string) {
  if (seen.has(item.view)) return;
  seen.add(item.view);
  const meta = standaloneViewMeta[item.view];
  const description = meta?.description || "打开对应工作页面";
  const keywords = [
    item.view,
    viewRoutes[item.view],
    item.label,
    group,
    meta?.title,
    description,
    tx(item.label),
    tx(group),
    meta?.title ? tx(meta.title) : "",
    tx(description),
  ].join(" ");
  items.push({
    id: `view:${item.view}`,
    view: item.view,
    label: item.label,
    group,
    description,
    icon: item.icon,
    tone: "page",
    keywords,
  });
}

export function topSearchEntityItems(user: AdminUser, data: AppData): TopSearchItem[] {
  const can = (view: ViewKey) => canAccessView(user, view);
  const items: TopSearchItem[] = [];
  if (can("models")) {
    for (const model of data.models.slice(0, 80)) {
      const label = model.name || model.id;
      items.push({
        id: `model:${model.id || model.name}`,
        view: "models",
        label,
        group: "模型目录",
        description: modelCapabilitySummary(model),
        icon: Boxes,
        tone: "entity",
        keywords: [label, model.id, model.modality, model.family, model.capabilities?.join(" "), "model", "models", "模型", "可用模型"].join(" "),
      });
    }
  }
  if (can("providers")) {
    for (const provider of data.providers.slice(0, 60)) {
      const label = provider.name || provider.id;
      items.push({
        id: `provider:${provider.id}`,
        view: "providers",
        label,
        group: "供应商",
        description: provider.healthy ? "Provider 健康" : "Provider 需要关注",
        icon: Server,
        tone: "entity",
        keywords: [label, provider.id, provider.base_url, provider.type, "provider", "渠道", "供应商"].join(" "),
      });
    }
  }
  if (can("projects")) {
    for (const project of data.projects.slice(0, 80)) {
      const label = project.name || project.id;
      items.push({
        id: `project:${project.id}`,
        view: "projects",
        label,
        group: "项目空间",
        description: "项目、Key、额度和成本归属",
        icon: LayoutDashboard,
        tone: "entity",
        keywords: [label, project.id, project.team_id, project.status, "project", "项目"].join(" "),
      });
    }
  }
  if (can("audit")) {
    for (const log of data.logs.slice(0, 50)) {
      const label = log.request_id || log.id;
      items.push({
        id: `request:${log.request_id || log.id}`,
        view: "audit",
        label,
        group: "请求日志",
        description: `${log.model || "-"} · HTTP ${log.status_code || "-"}`,
        icon: FileText,
        tone: "entity",
        keywords: [label, log.id, log.model, log.provider_id, log.provider_model, log.status_code, "request", "log", "日志"].join(" "),
      });
    }
  }
  return items;
}

export function topSearchResults(items: TopSearchItem[], role: AppRole, normalizedQuery: string, recentViews: ViewKey[]) {
  if (normalizedQuery) {
    return items.filter((item) => normalizeSearchText(item.keywords).includes(normalizedQuery)).slice(0, 8);
  }
  const preferred = topSearchPreferredViews[role];
  const recentItems = recentViews
    .map((view) => items.find((item) => item.view === view && item.id.startsWith("view:")))
    .filter((item): item is TopSearchItem => Boolean(item))
    .map((item) => ({ ...item, tone: "recent" as const }));
  const recentIDs = new Set(recentItems.map((item) => item.id));
  const preferredItems = items
    .filter((item) => item.id.startsWith("view:") && !recentIDs.has(item.id))
    .slice()
    .sort((left, right) => {
      const leftIndex = preferred.indexOf(left.view);
      const rightIndex = preferred.indexOf(right.view);
      const leftRank = leftIndex === -1 ? 99 : leftIndex;
      const rightRank = rightIndex === -1 ? 99 : rightIndex;
      return leftRank - rightRank;
    })
    .slice(0, Math.max(0, 6 - recentItems.length));
  return [...recentItems, ...preferredItems].slice(0, 6);
}

export function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

export function readRecentViews(): ViewKey[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recentViewsStorageKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((view): view is ViewKey => typeof view === "string" && view in viewRoutes).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberRecentView(view: ViewKey) {
  if (typeof window === "undefined") return;
  const next = [view, ...readRecentViews().filter((item) => item !== view)].slice(0, 5);
  window.localStorage.setItem(recentViewsStorageKey, JSON.stringify(next));
}

export function topQuickActionsForUser(user: AdminUser): NavLeafItem[] {
  const role = appRole(user.role);
  const candidates: Record<AppRole, NavLeafItem[]> = {
    admin: [
      { view: "providers", label: "供应商", icon: Server },
      { view: "routes", label: "路由策略", icon: Gauge },
      { view: "role-configs", label: "角色配置", icon: Settings },
    ],
    team_leader: [
      { view: "projects", label: "项目空间", icon: LayoutDashboard },
      { view: "api-keys", label: "Key 管理", icon: KeyRound },
      { view: "usage", label: "团队报表", icon: BarChart3 },
    ],
    user: [
      { view: "gateway", label: "接口文档", icon: Sparkles },
      { view: "playground", label: "模型演练场", icon: Send },
      { view: "api-keys", label: "Key 管理", icon: KeyRound },
    ],
    guest: [
      { view: "gateway", label: "接口文档", icon: Sparkles },
      { view: "balance-recharge", label: "余额充值", icon: CreditCard },
      { view: "api-keys", label: "Key 管理", icon: KeyRound },
    ],
  };
  return candidates[role].filter((item) => canAccessView(user, item.view));
}

export function roleScopeDescription(user: AdminUser) {
  switch (appRole(user.role)) {
    case "admin":
      return "全局平台范围";
    case "team_leader":
      return "团队和项目范围";
    case "guest":
      return "个人账户范围";
    default:
      return "个人可见范围";
  }
}
