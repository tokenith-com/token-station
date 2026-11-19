import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { type AdminUser, type AppData } from "../core/types";
import { firstActiveTeam, roleDisplayLabel, roleSelectOptions, userTeamIDs, userTeamLabels } from "../domain/entities";
import { tx } from "../i18n/runtime";
import { usePagination } from "./settings-table";
import { CustomerOnboardingDialog } from "./customer-onboarding";

export type PlatformAccountValues = Record<string, string>;

type AccountDialogState =
  | { mode: "create" }
  | { mode: "edit"; user: AdminUser }
  | { mode: "reset"; user: AdminUser };

export function PlatformAccountsView({
  variant,
  data,
  currentUser,
  loading,
  onCreate,
  onEdit,
  onResetPassword,
  onToggleStatus,
  onDelete,
  onOnboard,
}: {
  variant: "platform" | "team";
  data: AppData;
  currentUser: AdminUser;
  loading: boolean;
  onCreate: (values: PlatformAccountValues) => Promise<boolean>;
  onEdit: (user: AdminUser, values: PlatformAccountValues) => Promise<boolean>;
  onResetPassword: (user: AdminUser, values: PlatformAccountValues) => Promise<boolean>;
  onToggleStatus: (user: AdminUser) => Promise<void>;
  onDelete: (user: AdminUser) => void;
  onOnboard?: (values: PlatformAccountValues) => Promise<boolean>;
}) {
  const isTeamView = variant === "team";
  const canOnboard = !isTeamView && currentUser.role.trim().toLowerCase() === "admin" && Boolean(onOnboard);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(() => isTeamView ? "active" : "all");
  const [dialog, setDialog] = useState<AccountDialogState | null>(null);
  const roles = useMemo(() => roleSelectOptions(data), [data]);
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.users.filter((user) => {
      const matchesQuery = !normalizedQuery || [user.name, user.description, user.username, ...(isTeamView ? [user.email] : [])]
        .some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
      const matchesScope = isTeamView || scopeFilter === "all" || user.role === scopeFilter;
      const matchesStatus = statusFilter === "all" || normalizedStatus(user.status) === statusFilter;
      return matchesQuery && matchesScope && matchesStatus;
    });
  }, [data.users, isTeamView, query, scopeFilter, statusFilter]);
  const pagination = usePagination(filteredUsers.length, `${query}:${scopeFilter}:${statusFilter}`, 10);
  const visibleUsers = filteredUsers.slice(pagination.startIndex, pagination.endIndex);

  return (
    <section className={`platform-accounts-view${isTeamView ? " team-accounts-view" : ""}`} aria-label={tx(isTeamView ? "团队用户列表" : "平台账户")}>
      <div className="platform-accounts-toolbar">
        <div className="platform-account-filters">
          <button className="platform-account-create" onClick={() => setDialog({ mode: "create" })} type="button">
            <Plus size={14} />
            {tx(isTeamView ? "新增团队成员" : "新增用户")}
          </button>
          {canOnboard ? <button className="platform-account-create" disabled={loading} onClick={() => setOnboardingOpen(true)} type="button"><Plus size={14} />{tx("开通客户")}</button> : null}
        </div>

        <div className="platform-account-filters">
          <label className="platform-account-search">
            <Search aria-hidden="true" size={14} />
            <input
              aria-label={tx(isTeamView ? "搜索团队成员" : "搜索平台账号")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tx("搜索")}
              type="search"
              value={query}
            />
          </label>
          {!isTeamView ? (
            <label className="platform-account-select">
              <span>{tx("角色：")}</span>
              <select aria-label={tx("角色筛选")} onChange={(event) => setScopeFilter(event.target.value)} value={scopeFilter}>
                <option value="all">{tx("全部角色")}</option>
                {roles.map((option) => <option key={option.value} value={option.value}>{tx(option.label)}</option>)}
              </select>
            </label>
          ) : null}
          <label className="platform-account-select">
            <span>{tx("状态：")}</span>
            <select aria-label={tx("状态筛选")} onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
              <option value="all">{tx("全部状态")}</option>
              <option value="active">{tx("已启用")}</option>
              <option value="disabled">{tx("已禁用")}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="platform-account-table-wrap">
        <table className="platform-account-table">
          <thead>
            <tr>
              <th>{tx("姓名")}</th>
              <th>{tx("备注")}</th>
              <th>{tx("用户名")}</th>
              {isTeamView ? <th>{tx("邮箱")}</th> : null}
              <th>{tx("角色")}</th>
              <th>{tx("团队")}</th>
              <th>{tx("状态")}</th>
              <th>{tx("创建时间")}</th>
              <th>{tx("操作")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.length > 0 ? visibleUsers.map((user) => {
              const active = normalizedStatus(user.status) === "active";
              const isCurrentUser = user.id === currentUser.id;
              const teamsLabel = userTeamLabels(data, user);
              return (
                <tr key={user.id}>
                  <td>{user.name || "-"}</td>
                  <td>{user.description || "-"}</td>
                  <td>{user.username || "-"}</td>
                  {isTeamView ? <td>{user.email || "-"}</td> : null}
                  <td className="platform-account-role">{roleDisplayLabel(data, user.role)}</td>
                  <td title={teamsLabel}>{teamsLabel}</td>
                  <td><span className={`platform-account-status ${active ? "is-active" : "is-disabled"}`}>{tx(active ? "已启用" : "已禁用")}</span></td>
                  <td className="platform-account-created-at">{formatAccountTime(user.created_at)}</td>
                  <td>
                    <div className="platform-account-actions">
                      <button
                        disabled={loading || isCurrentUser}
                        onClick={() => void onToggleStatus(user)}
                        title={isCurrentUser ? tx("不能停用当前登录账号") : undefined}
                        type="button"
                      >
                        {tx(active ? "禁用" : "启用")}
                      </button>
                      <button disabled={loading} onClick={() => setDialog({ mode: "edit", user })} type="button">{tx("编辑")}</button>
                      {!isTeamView ? <button disabled={loading} onClick={() => setDialog({ mode: "reset", user })} type="button">{tx("重置密码")}</button> : null}
                      <button className="is-danger" disabled={loading || isCurrentUser} onClick={() => onDelete(user)} type="button">{tx("删除")}</button>
                    </div>
                  </td>
                </tr>
              );
            }) : (
              <tr><td className="platform-account-empty" colSpan={isTeamView ? 9 : 8}>{loading ? tx("加载中") : tx(isTeamView ? "暂无符合条件的团队成员" : "暂无符合条件的平台账号")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <AccountPagination pagination={pagination} totalItems={filteredUsers.length} />

      {onboardingOpen && canOnboard && onOnboard ? <CustomerOnboardingDialog onClose={() => setOnboardingOpen(false)} onSubmit={onOnboard} /> : null}
      {dialog ? (
        <PlatformAccountDialog
          data={data}
          currentUser={currentUser}
          loading={loading}
          variant={variant}
          state={dialog}
          onClose={() => setDialog(null)}
          onSubmit={async (values) => {
            const saved = await (dialog.mode === "create"
              ? onCreate(values)
              : dialog.mode === "edit"
                ? onEdit(dialog.user, values)
                : onResetPassword(dialog.user, values));
            setDialog(null);
            return saved;
          }}
        />
      ) : null}
    </section>
  );
}

export function AccountPagination({
  pagination,
  totalItems,
}: {
  pagination: ReturnType<typeof usePagination>;
  totalItems: number;
}) {
  const pages = Array.from({ length: pagination.pageCount }, (_, index) => index + 1);
  return (
    <div className="platform-account-pagination">
      <span>{tx(`共 ${totalItems} 条数据`)}</span>
      <div className="platform-account-page-controls">
        <button aria-label={tx("上一页")} disabled={pagination.page <= 1} onClick={() => pagination.setPage(pagination.page - 1)} type="button">
          <ChevronLeft size={15} />
        </button>
        {pages.slice(0, 5).map((page) => (
          <button className={page === pagination.page ? "is-current" : ""} key={page} onClick={() => pagination.setPage(page)} type="button">{page}</button>
        ))}
        {pagination.pageCount > 6 ? <span aria-hidden="true">...</span> : null}
        {pagination.pageCount > 5 ? (
          <button className={pagination.pageCount === pagination.page ? "is-current" : ""} onClick={() => pagination.setPage(pagination.pageCount)} type="button">{pagination.pageCount}</button>
        ) : null}
        <button aria-label={tx("下一页")} disabled={pagination.page >= pagination.pageCount} onClick={() => pagination.setPage(pagination.page + 1)} type="button">
          <ChevronRight size={15} />
        </button>
        <select aria-label={tx("每页条数")} onChange={(event) => pagination.setPageSize(Number(event.target.value))} value={pagination.pageSize}>
          {[10, 20, 50].map((size) => <option key={size} value={size}>{size}/页</option>)}
        </select>
      </div>
    </div>
  );
}

function PlatformAccountDialog({
  state,
  data,
  currentUser,
  variant,
  loading,
  onClose,
  onSubmit,
}: {
  state: AccountDialogState;
  data: AppData;
  currentUser: AdminUser;
  variant: "platform" | "team";
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: PlatformAccountValues) => Promise<boolean>;
}) {
  const isCreate = state.mode === "create";
  const isEdit = state.mode === "edit";
  const isTeamView = variant === "team";
  const user = state.mode === "create" ? null : state.user;
  const roles = roleSelectOptions(data);
  const defaultTeamID = firstActiveTeam(data)?.id || (isTeamView ? userTeamIDs(currentUser)[0] ?? "" : "");
  const [values, setValues] = useState<PlatformAccountValues>(() => ({
    name: user?.name ?? "",
    description: user?.description ?? "",
    role: user?.role ?? (isTeamView ? "user" : ""),
    username: user?.username ?? "",
    email: user?.email ?? "",
    team_id: isCreate ? defaultTeamID : user?.team_id ?? "",
    team_ids: userTeamIDs(user).filter((teamID) => teamID !== user?.team_id).join(", "),
    status: user?.status ?? "active",
    password: "",
    confirmPassword: "",
  }));
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onClose]);

  function update(key: string, value: string) {
    setValidationError("");
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missingBasic = (isCreate || isEdit) && (!values.name.trim() || (isTeamView ? !values.email.trim() : !values.role));
    const missingLogin = isCreate && (!values.username.trim() || !values.password || !values.confirmPassword);
    const missingReset = state.mode === "reset" && (!values.password || !values.confirmPassword);
    if (missingBasic || missingLogin || missingReset) {
      setValidationError(tx("请填写所有必填项"));
      return;
    }
    const changingPassword = isCreate || state.mode === "reset" || (isTeamView && isEdit && Boolean(values.password || values.confirmPassword));
    if (changingPassword && values.password !== values.confirmPassword) {
      setValidationError(tx("两次输入的密码不一致"));
      return;
    }
    // Consumer accounts never belong to a team.
    if (["consumer", "guest"].includes(values.role)) {
      await onSubmit({ ...values, team_id: "", team_ids: "" });
      return;
    }
    const teamID = values.team_id || defaultTeamID;
    if (isCreate && !isTeamView && !teamID) {
      setValidationError(tx("暂无可用的主团队，请联系平台管理员配置团队后重试"));
      return;
    }
    // 团队视图的新建走团队成员接口，团队由后端按调用者强制指定。
    await onSubmit(isCreate && !isTeamView ? { ...values, team_id: teamID } : values);
  }

  const title = isCreate
    ? (isTeamView ? "新增团队成员" : "新增用户")
    : isEdit ? "编辑" : "重置密码";
  return (
    <div className="modal-backdrop platform-account-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onClose();
    }} role="presentation">
      <form aria-labelledby="platform-account-dialog-title" aria-modal="true" className={`platform-account-dialog${isTeamView ? " team-account-dialog" : ""} is-${state.mode}`} onSubmit={submit} role="dialog">
        <header className="platform-account-dialog-header">
          <h2 id="platform-account-dialog-title">{tx(title)}</h2>
          <button aria-label={tx("关闭")} disabled={loading} onClick={onClose} type="button"><X size={17} /></button>
        </header>

        <div className="platform-account-dialog-body">
          {isCreate || isEdit ? (
            <AccountFormSection title="基本信息">
              <AccountField label="姓名" required>
                <input autoFocus maxLength={80} onChange={(event) => update("name", event.target.value)} placeholder={tx("请输入")} value={values.name} />
              </AccountField>
              <AccountField label="备注">
                <input maxLength={160} onChange={(event) => update("description", event.target.value)} placeholder={tx("请输入")} value={values.description} />
              </AccountField>
              {isTeamView ? (
                <AccountField label="邮箱" required>
                  <input autoComplete="email" onChange={(event) => update("email", event.target.value)} placeholder={tx("请输入")} required type="email" value={values.email} />
                </AccountField>
              ) : null}
              {!isTeamView ? (
                <AccountField className="platform-account-role-field" label="角色">
                  <select disabled={isEdit} onChange={(event) => update("role", event.target.value)} value={values.role}>
                    {isCreate ? <option value="">{tx("请选择")}</option> : null}
                    {roles.map((role) => <option key={role.value} value={role.value}>{tx(role.label)}</option>)}
                  </select>
                </AccountField>
              ) : null}
            </AccountFormSection>
          ) : null}

          {isCreate && isTeamView ? (
            <p className="platform-account-form-hint">
              {tx("创建后将自动加入你负责的第一个活跃项目空间，项目角色为 developer（可发放 Key）。")}
            </p>
          ) : null}

          {isCreate || state.mode === "reset" || (isTeamView && isEdit) ? (
            <AccountFormSection title="登录信息">
              <AccountField label="用户名" required>
                <input
                  autoFocus={state.mode === "reset"}
                  disabled={!isCreate}
                  maxLength={80}
                  onChange={(event) => update("username", event.target.value)}
                  placeholder={tx("请输入")}
                  value={values.username}
                />
              </AccountField>
              <AccountField label={state.mode === "reset" ? "新密码" : "密码"} required>
                <input autoComplete="new-password" onChange={(event) => update("password", event.target.value)} placeholder={tx(isEdit ? "编辑时留空则不修改" : "请输入")} type="password" value={values.password} />
              </AccountField>
              <AccountField label={state.mode === "reset" ? "确认新密码" : "确认密码"} required>
                <input autoComplete="new-password" onChange={(event) => update("confirmPassword", event.target.value)} placeholder={tx(isEdit ? "编辑时留空则不修改" : "请输入")} type="password" value={values.confirmPassword} />
              </AccountField>
            </AccountFormSection>
          ) : null}
          {validationError ? <p className="platform-account-form-error" role="alert">{validationError}</p> : null}
        </div>

        <footer className="platform-account-dialog-actions">
          <button className="platform-account-cancel" disabled={loading} onClick={onClose} type="button">{tx("取消")}</button>
          <button className="platform-account-confirm" disabled={loading} type="submit">{loading ? tx("保存中") : tx("确定")}</button>
        </footer>
      </form>
    </div>
  );
}

export function AccountFormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="platform-account-form-section">
      <h3><i aria-hidden="true" />{tx(title)}</h3>
      <div className="platform-account-form-fields">{children}</div>
    </section>
  );
}

export function AccountField({
  label,
  required = false,
  className = "",
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`platform-account-field ${className}`.trim()}>
      <span>{required ? <b aria-hidden="true">*</b> : null}{tx(label)}</span>
      {children}
    </label>
  );
}

export function normalizedStatus(status: string) {
  return ["active", "enabled", "healthy"].includes(String(status).toLowerCase()) ? "active" : "disabled";
}

export function formatAccountTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
