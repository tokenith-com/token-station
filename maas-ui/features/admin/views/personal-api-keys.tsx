import { Plus } from "lucide-react";
import { SvgIcon } from "../../../components/svg-icon";
import type { APIKey } from "../core/types";
import { tx } from "../i18n/runtime";
import { APIKeyValue } from "../shared/api-key-value";
import { AccountPagination, formatAccountTime, normalizedStatus } from "./platform-accounts";
import { usePagination } from "./settings-table";

export function PersonalAPIKeysView({
  keys,
  loading,
  onCreate,
  onDelete,
  onToggleStatus,
}: {
  keys: APIKey[];
  loading: boolean;
  onCreate: () => void;
  onDelete: (key: APIKey) => void;
  onToggleStatus: (key: APIKey) => void;
}) {
  const pagination = usePagination(keys.length, "personal-api-keys", 10);
  const visibleKeys = keys.slice(pagination.startIndex, pagination.endIndex);

  return (
    <section className="platform-accounts-view personal-api-keys-view" aria-labelledby="personal-api-keys-title">
      <div className="platform-accounts-title">
        <SvgIcon name="overview-icon" size={16} />
        <h1 id="personal-api-keys-title">{tx("API Key 管理")}</h1>
      </div>

      <div className="personal-api-keys-toolbar">
        <button className="platform-account-create" disabled={loading} onClick={onCreate} type="button">
          <Plus size={14} />
          {tx("新建 API Key")}
        </button>
      </div>

      <div className="platform-account-table-wrap personal-api-key-table-wrap">
        <table className="platform-account-table personal-api-key-table">
          <thead>
            <tr>
              <th>{tx("名称")}</th>
              <th>{tx("Key 值")}</th>
              <th>{tx("状态")}</th>
              <th>{tx("创建时间")}</th>
              <th>{tx("操作")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleKeys.length > 0 ? (
              visibleKeys.map(key => {
                const active = normalizedStatus(key.status) === "active";
                return (
                  <tr key={key.id}>
                    <td>{key.name || "-"}</td>
                    <td>
                      <APIKeyValue apiKey={key} />
                    </td>
                    <td>
                      <span className={`platform-account-status ${active ? "is-active" : "is-disabled"}`}>{tx(active ? "生效中" : "已禁用")}</span>
                    </td>
                    <td>{formatAccountTime(key.created_at)}</td>
                    <td>
                      <div className="platform-account-actions">
                        <button disabled={loading} onClick={() => onToggleStatus(key)} type="button">
                          {tx(active ? "禁用" : "启用")}
                        </button>
                        <button className="is-danger" disabled={loading} onClick={() => onDelete(key)} type="button">
                          {tx("删除")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="platform-account-empty" colSpan={5}>
                  {loading ? tx("加载中") : tx("暂无 API Key")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AccountPagination pagination={pagination} totalItems={keys.length} />
    </section>
  );
}
