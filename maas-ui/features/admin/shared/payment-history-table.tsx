import type { ReactNode } from "react";
import { tx } from "../i18n/runtime";
import { PaginationControls, type PaginationState } from "./pagination";

export function PaymentHistoryTable({ label, columns, rows, pagination, total, loading }: {
  label: string;
  columns: string[];
  rows: ReactNode[][];
  pagination: PaginationState;
  total: number;
  loading: boolean;
}) {
  return (
    <div className="payment-history-table" aria-busy={loading}>
      <div className="table-wrap">
        <table aria-label={label}>
          <thead>
            <tr>
              {columns.map(column => <th key={column} scope="col">{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={pagination.startIndex + index}>
                {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="payment-history-empty" colSpan={columns.length}>
                  {loading ? tx("加载中") : tx("暂无数据")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls pagination={pagination} totalItems={total} alwaysVisible disabled={loading} />
    </div>
  );
}
