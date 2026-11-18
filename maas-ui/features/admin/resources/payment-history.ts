import { useCallback, useEffect, useState } from "react";
import type { ApiContext } from "../core/types";
import { usePagination } from "../shared/pagination";
import { walletRequest } from "./wallet";

export type PaymentOrder = { order_no: string; status: string; qr_code?: string; pay_url?: string; amount_fen?: number; channel?: string; created_at?: number };

export function usePaymentHistory<T>(api: ApiContext, path: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const pagination = usePagination(total, path + api.baseURL + api.adminToken);
  const { page, pageSize } = pagination;
  const { baseURL, adminToken } = api;
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    const offset = (page - 1) * pageSize;
    void walletRequest<{ data: T[]; total: number }>({ baseURL, adminToken }, `${path}?limit=${pageSize}&offset=${offset}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setRows(result.data);
        setTotal(result.total ?? result.data.length);
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [baseURL, adminToken, path, page, pageSize, revision]);

  return { rows, setRows, total, error, loading, pagination, refresh };
}
