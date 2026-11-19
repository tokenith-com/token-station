import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { type AdminResource, type AppData, type ModalState, type ResourceConfig } from "../core/types";
import { roleDisplayName, stringifyValue } from "../domain/entities";
import { tx } from "../i18n/runtime";
import { roleConfig } from "../resources/settings-config";

const rolePageSizes = [10, 20, 50];

export function RoleManagementView({
  data,
  loading,
  onEdit,
  onDelete,
}: {
  data: AppData;
  loading: boolean;
  onEdit: (config: ResourceConfig<AdminResource>, item: AdminResource) => void;
  onDelete: (config: ResourceConfig<AdminResource>, item: AdminResource) => void;
}) {
  const config = useMemo(() => roleConfig(), []);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const roles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return config.list(data).filter((item) => {
      if (!normalizedQuery) return true;
      return [roleDisplayName(item), item.description, stringifyValue(item.fields?.role_key)]
        .some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
    });
  }, [config, data, query]);
  const pageCount = Math.max(1, Math.ceil(roles.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRoles = roles.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <section className="role-management-view">
      <label className="role-management-search">
        <Search aria-hidden="true" size={15} />
        <input
          aria-label={tx("搜索角色")}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tx("搜索")}
          type="search"
          value={query}
        />
      </label>

      <div className="role-management-table-wrap">
        <table className="role-management-table">
          <thead>
            <tr>
              <th>{tx("角色名称")}</th>
              <th>{tx("备注")}</th>
              <th>{tx("操作")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRoles.length > 0 ? visibleRoles.map((item) => {
              const isBuiltInAdmin = stringifyValue(item.fields?.role_key) === "admin";
              return (
                <tr key={item.id}>
                  <td>{roleDisplayName(item)}</td>
                  <td>{item.description || "-"}</td>
                  <td>
                    {!isBuiltInAdmin ? (
                      <div className="role-management-actions">
                        <button disabled={loading} onClick={() => onEdit(config, item)} type="button">{tx("编辑")}</button>
                        <button className="is-danger" disabled={loading} onClick={() => onDelete(config, item)} type="button">{tx("删除")}</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td className="role-management-empty" colSpan={3}>{loading ? tx("加载中") : tx("暂无符合条件的角色")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="role-management-pagination">
        <span>{tx(`共 ${roles.length} 条数据`)}</span>
        <div>
          <button
            aria-label={tx("上一页")}
            disabled={safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          {visiblePageNumbers(safePage, pageCount).map((pageNumber) => (
            <button
              aria-current={pageNumber === safePage ? "page" : undefined}
              className={pageNumber === safePage ? "is-active" : ""}
              key={pageNumber}
              onClick={() => setPage(pageNumber)}
              type="button"
            >
              {pageNumber}
            </button>
          ))}
          <button
            aria-label={tx("下一页")}
            disabled={safePage >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            type="button"
          >
            <ChevronRight size={16} />
          </button>
          <select
            aria-label={tx("每页数量")}
            onChange={(event) => setPageSize(Number(event.target.value))}
            value={pageSize}
          >
            {rolePageSizes.map((option) => <option key={option} value={option}>{option}/页</option>)}
          </select>
        </div>
      </footer>
    </section>
  );
}

export function RoleManagementEditModal({
  state,
  loading,
  onClose,
  onSave,
}: {
  state: ModalState<AdminResource>;
  loading: boolean;
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
}) {
  const item = state.item;
  const originalValues = useMemo(() => item && state.config.toForm ? state.config.toForm(item) : {}, [item, state.config]);
  const name = item ? roleDisplayName(item) : "";
  const [description, setDescription] = useState(() => item?.description ?? "");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onClose]);

  useEffect(() => {
    if (descriptionRef.current) resizeDescription(descriptionRef.current);
  }, [description]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    onSave({
      ...originalValues,
      name: nextName,
      display_name: nextName,
      description: description.trim(),
    });
  }

  return (
    <div
      className="modal-backdrop role-management-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose();
      }}
      role="presentation"
    >
      <form aria-labelledby="role-management-dialog-title" aria-modal="true" className="role-management-dialog" onSubmit={submit} role="dialog">
        <header className="role-management-dialog-header">
          <h2 id="role-management-dialog-title">{tx("编辑")}</h2>
          <button aria-label={tx("关闭")} disabled={loading} onClick={onClose} type="button"><X size={17} /></button>
        </header>
        <div className="role-management-dialog-body">
          <h3><i aria-hidden="true" />{tx("基本信息")}</h3>
          <label className="role-management-field">
            <span><b aria-hidden="true">*</b>{tx("角色名称")}：</span>
            <input
              disabled
              placeholder={tx("请输入")}
              value={name}
            />
          </label>
          <label className="role-management-field">
            <span>{tx("备注")}：</span>
            <textarea
              autoFocus
              onChange={(event) => {
                setDescription(event.target.value);
                resizeDescription(event.currentTarget);
              }}
              placeholder={tx("请输入")}
              ref={descriptionRef}
              rows={2}
              value={description}
            />
          </label>
        </div>
        <footer className="role-management-dialog-actions">
          <button className="role-management-cancel" disabled={loading} onClick={onClose} type="button">{tx("取消")}</button>
          <button className="role-management-confirm" disabled={loading} type="submit">{loading ? tx("保存中") : tx("确定")}</button>
        </footer>
      </form>
    </div>
  );
}

function resizeDescription(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  const nextHeight = Math.min(textarea.scrollHeight, 500);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > 500 ? "auto" : "hidden";
}

function visiblePageNumbers(page: number, pageCount: number) {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const start = Math.min(Math.max(page - 2, 1), pageCount - 4);
  return Array.from({ length: 5 }, (_, index) => start + index);
}
