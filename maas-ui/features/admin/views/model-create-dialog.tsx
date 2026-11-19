import { useState } from "react";
import { type ApiContext, type AppData, type Model, type ResourceConfig } from "../core/types";
import { externalModelTemplateValues } from "../domain/model-create-wizard";
import { availableProviderModelSelectOptions, initialModelRoutes } from "../domain/provider-model-selection";
import { splitList } from "../domain/labels";
import { tx } from "../i18n/runtime";
import { adminFetch, isAuthExpiredError, modelPayload, readAdminError } from "../resources/payloads";
import { ModelCreateModal } from "./model-create-modal";

export function ModelCreateDialog({ api, config, data, loading, onClose, onSaved }: {
  api: ApiContext;
  config: ResourceConfig<Model>;
  data: AppData;
  loading: boolean;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => externalModelTemplateValues({ name: "", category: "custom", family: "custom", modality: "chat" }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(form: Record<string, string>) {
    if (busy || loading) return;
    const available = new Set(availableProviderModelSelectOptions(data).map((item) => item.value));
    const selected = splitList(form.initial_provider_models);
    const name = form.name.trim();
    if (!name || selected.length === 0 || selected.some((item) => !available.has(item))) {
      setError(tx("请选择至少一个已引入的 Provider 模型。"));
      return;
    }
    const routes = initialModelRoutes(form.initial_provider_models).map((route) => ({
      ...route, model_name: name, priority: 0, quality_score: 60, cost_score: 60, strategy: "balanced",
    }));
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...modelPayload({ ...form, name }, { source: "manual-external", directory_role: "external" }),
        id: name,
        input_modalities: splitList(form.input_modalities),
        output_modalities: splitList(form.output_modalities),
        routes,
      };
      const response = await adminFetch(api, "/api/admin/models", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readAdminError(response, tx("创建对外模型")));
      await onSaved(tx(form.status === "active" ? "对外模型已创建并发布" : "对外模型已保存为草稿"));
    } catch (err) {
      if (isAuthExpiredError(err)) return;
      setError(err instanceof Error ? err.message : tx("保存失败"));
    } finally {
      setBusy(false);
    }
  }

  return <ModelCreateModal config={config} data={data} values={values} setValues={setValues}
    loading={busy || loading} error={error} onClose={onClose} onSave={(form) => void save(form)} />;
}
