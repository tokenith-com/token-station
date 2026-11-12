import { Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { SvgIcon } from "../../../components/svg-icon";
import { type AdminResource, type AppData } from "../core/types";
import { tx } from "../i18n/runtime";
import {
  AccountField,
  AccountFormSection,
  AccountPagination,
  formatAccountTime,
  normalizedStatus,
} from "./platform-accounts";
import { usePagination } from "./settings-table";

export type TeamGroupValues = Record<string, string>;

type TeamGroupDialogState =
  | { mode: "create" }
  | { mode: "edit"; group: AdminResource };

export function TeamGroupsView({
  data,
  loading,
  onCreate,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  data: AppData;
  loading: boolean;
  onCreate: (values: TeamGroupValues) => Promise<boolean>;
  onEdit: (group: AdminResource, values: TeamGroupValues) => Promise<boolean>;
  onToggleStatus: (group: AdminResource) => Promise<void>;
  onDelete: (group: AdminResource) => void;
}) {
  const groups = useMemo(() => data.resources.teams ?? [], [data.resources.teams]);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialog, setDialog] = useState<TeamGroupDialogState | null>(null);
  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of data.users) {
      if (user.team_id) counts.set(user.team_id, (counts.get(user.team_id) ?? 0) + 1);
    }
    return counts;
  }, [data.users]);
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return groups.filter((group) => {
      const matchesQuery = !normalizedQuery || [group.name, group.description]
        .some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
      const matchesGroup = groupFilter === "all" || group.id === groupFilter;
      const matchesStatus = statusFilter === "all" || normalizedStatus(group.status) === statusFilter;
      return matchesQuery && matchesGroup && matchesStatus;
    });
  }, [groupFilter, groups, query, statusFilter]);
  const pagination = usePagination(filteredGroups.length, `${query}:${groupFilter}:${statusFilter}`, 10);
  const visibleGroups = filteredGroups.slice(pagination.startIndex, pagination.endIndex);

  return (
    <section aria-labelledby="team-groups-title" className="platform-accounts-view team-groups-view">
      <div className="platform-accounts-title">
        <SvgIcon name="overview-icon" size={16} />
        <h1 id="team-groups-title">{tx("团队分组列表")}</h1>
      </div>

      <div className="platform-accounts-toolbar">
        <button className="platform-account-create" onClick={() => setDialog({ mode: "create" })} type="button">
          <Plus size={14} />
          {tx("新增团队分组")}
        </button>

        <div className="platform-account-filters">
          <label className="platform-account-search">
            <Search aria-hidden="true" size={14} />
            <input
              aria-label={tx("搜索团队分组")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tx("搜索")}
              type="search"
              value={query}
            />
          </label>
          <label className="platform-account-select">
            <span>{tx("分组：")}</span>
            <select aria-label={tx("分组筛选")} onChange={(event) => setGroupFilter(event.target.value)} value={groupFilter}>
              <option value="all">{tx("全部分组")}</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{tx(group.name)}</option>)}
            </select>
          </label>
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
              <th>{tx("分组名称")}</th>
              <th>{tx("备注")}</th>
              <th>{tx("成员数")}</th>
              <th>{tx("状态")}</th>
              <th>{tx("创建时间")}</th>
              <th>{tx("操作")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.length > 0 ? visibleGroups.map((group) => {
              const active = normalizedStatus(group.status) === "active";
              return (
                <tr key={group.id}>
                  <td>{group.name || "-"}</td>
                  <td>{group.description || "-"}</td>
                  <td>{memberCounts.get(group.id) ?? 0}</td>
                  <td><span className={`platform-account-status ${active ? "is-active" : "is-disabled"}`}>{tx(active ? "已启用" : "已禁用")}</span></td>
                  <td>{formatAccountTime(group.created_at)}</td>
                  <td>
                    <div className="platform-account-actions">
                      <button disabled={loading} onClick={() => void onToggleStatus(group)} type="button">{tx(active ? "禁用" : "启用")}</button>
                      <button disabled={loading} onClick={() => setDialog({ mode: "edit", group })} type="button">{tx("编辑")}</button>
                      <button className="is-danger" disabled={loading} onClick={() => onDelete(group)} type="button">{tx("删除")}</button>
                    </div>
                  </td>
                </tr>
              );
            }) : (
              <tr><td className="platform-account-empty" colSpan={6}>{loading ? tx("加载中") : tx("暂无符合条件的团队分组")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <AccountPagination pagination={pagination} totalItems={filteredGroups.length} />

      {dialog ? (
        <TeamGroupDialog
          key={dialog.mode === "edit" ? `edit:${dialog.group.id}` : "create"}
          loading={loading}
          state={dialog}
          onClose={() => setDialog(null)}
          onSubmit={async (values) => {
            await (dialog.mode === "create" ? onCreate(values) : onEdit(dialog.group, values));
            setDialog(null);
          }}
        />
      ) : null}
    </section>
  );
}

function TeamGroupDialog({
  state,
  loading,
  onClose,
  onSubmit,
}: {
  state: TeamGroupDialogState;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: TeamGroupValues) => Promise<void>;
}) {
  const group = state.mode === "edit" ? state.group : null;
  const [values, setValues] = useState<TeamGroupValues>({
    name: group?.name ?? "",
    description: group?.description ?? "",
    status: group?.status ?? "active",
  });
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
    if (!values.name.trim()) {
      setValidationError(tx("请填写所有必填项"));
      return;
    }
    await onSubmit({ ...values, name: values.name.trim() });
  }

  const title = state.mode === "create" ? "新增分组" : "编辑";
  return (
    <div className="modal-backdrop platform-account-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !loading) onClose();
    }} role="presentation">
      <form aria-labelledby="team-group-dialog-title" aria-modal="true" className={`platform-account-dialog team-group-dialog is-${state.mode}`} onSubmit={submit} role="dialog">
        <header className="platform-account-dialog-header">
          <h2 id="team-group-dialog-title">{tx(title)}</h2>
          <button aria-label={tx("关闭")} disabled={loading} onClick={onClose} type="button"><X size={17} /></button>
        </header>
        <div className="platform-account-dialog-body">
          <AccountFormSection title="基本信息">
            <AccountField label="分组名称" required>
              <input autoFocus maxLength={80} onChange={(event) => update("name", event.target.value)} placeholder={tx("请输入")} value={values.name} />
            </AccountField>
            <AccountField label="备注">
              <input maxLength={200} onChange={(event) => update("description", event.target.value)} placeholder={tx("请输入")} value={values.description} />
            </AccountField>
          </AccountFormSection>
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
