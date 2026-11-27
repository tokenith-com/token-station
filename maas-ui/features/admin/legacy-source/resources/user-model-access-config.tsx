import { CustomerStaticText } from "../../i18n/customer-copy";
import type { AdminResource, AppData, ResourceConfig } from "../core/types";
import { apiKeyOwnerSelectOptions, ownerUserLabel, stringifyValue } from "../domain/entities";
import { tx } from "../i18n/runtime";
import { externalModels } from "../domain/model-directory";
import { genericResourceConfig } from "./generic-config";

function userModelAccessLabel(item: AdminResource, data: AppData) {
  const userID = stringifyValue(item.fields?.user_id);
  return ownerUserLabel(data, userID) || userID;
}

function selectedModels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function modelAccessSummary(item: AdminResource) {
  const mode = stringifyValue(item.fields?.model_access_mode);
  if (mode === "restricted") {
    return tx("白名单 · {count} 个模型").replace("{count}", String(selectedModels(item.fields?.allowed_models).length));
  }
  if (mode === "excluded") {
    return tx("黑名单 · {count} 个模型").replace("{count}", String(selectedModels(item.fields?.excluded_models).length));
  }
  return <CustomerStaticText value="继承项目范围" />;
}

// Only configured directory models are selectable. The raw model list carries
// every upstream model the providers advertise, which is not what an operator
// scopes access to.
function modelSelectOptions(data: AppData) {
  return externalModels(data)
    .filter((model) => model.status === "active")
    .map((model) => ({ value: model.name, label: model.name }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

// A user scope only narrows the project boundary. The backend rejects any model
// the user's projects do not already allow, so the form offers reachable ones.
export function userModelAccessConfig(): ResourceConfig<AdminResource> {
  const base = genericResourceConfig("user-model-access", "用户模型权限", "按用户收紧可调用的模型范围；用户范围不能突破所属项目的限制", [
    {
      key: "user_id",
      label: "用户",
      type: "select",
      optionsFromData: apiKeyOwnerSelectOptions,
      required: true,
      help: "Key 的模型上限由归属用户决定，转借 Key 不会提高权限。",
    },
    {
      key: "model_access_mode",
      label: "范围模式",
      type: "select",
      optionsFromData: (_data, currentUser) => [
        { value: "inherit", label: tx(currentUser?.role === "admin" ? "继承客户项目范围" : "继承项目范围") },
        { value: "restricted", label: tx("白名单模式") },
        { value: "excluded", label: tx("黑名单模式") },
      ],
      required: true,
      help: "继承：跟随项目范围；白名单：只允许选中模型；黑名单：排除选中模型。",
    },
    {
      key: "allowed_models",
      label: "允许的模型",
      type: "multi-select",
      optionsFromData: modelSelectOptions,
      visible: (values: Record<string, string>) => values.model_access_mode === "restricted",
      help: "保存时校验这些模型未超出项目允许范围。",
    },
    {
      key: "excluded_models",
      label: "排除的模型",
      type: "multi-select",
      optionsFromData: modelSelectOptions,
      visible: (values: Record<string, string>) => values.model_access_mode === "excluded",
    },
  ]);
  return {
    ...base,
    columns: [
      { key: "user_id", label: "用户", render: (item, ctx) => userModelAccessLabel(item, ctx) },
      { key: "model_access_mode", label: "模型范围", render: (item) => modelAccessSummary(item) },
      // genericResourceConfig already appends a status column.
    ],
  };
}
