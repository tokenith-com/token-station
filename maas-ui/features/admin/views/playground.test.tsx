import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { canAccessView } from "../core/navigation";
import { type AdminUser, type APIKey } from "../core/types";
import { emptyData } from "../domain/catalog";
import { streamPlaygroundChat } from "../resources/playground-stream";
import { PlaygroundPage, PlaygroundPanel } from "./playground";

vi.mock("../resources/playground-stream", async (importOriginal) => ({
  ...await importOriginal<typeof import("../resources/playground-stream")>(), streamPlaygroundChat: vi.fn(),
}));

const api = { baseURL: "", adminToken: "test" };
const modelA = "a-chat";
const modelB = "b-chat";

function playgroundKey(id: string, name: string, overrides: Partial<APIKey> = {}): APIKey {
  return {
    id, name, project_id: "project", owner_user_id: "user", key_prefix: "thk_", key_suffix: id.slice(-4),
    allowed_models: [], status: "active", ...overrides,
  };
}

function fixture() {
  const data = emptyData();
  data.projects = [{ id: "project", name: "Project", status: "active" }];
  data.keys = [playgroundKey("key", "Key")];
  data.models = [
    { id: "a", name: modelA, family: "custom", modality: "chat", status: "active", supported_parameters: ["temperature", "top_p"], context_window: 32768 },
    { id: "b", name: modelB, family: "custom", modality: "chat", status: "active", supported_parameters: ["temperature"], metadata: { max_output_tokens: "512" }, context_window: 2048 },
  ];
  data.routes = data.models.map((model) => ({
    id: model.id, model_name: model.name, provider_id: "provider", provider_model: model.name, priority: 1, weight: 1, status: "active",
  }));
  return data;
}

function send(content: string) {
  fireEvent.change(screen.getByPlaceholderText("输入用于诊断模型的消息..."), { target: { value: content } });
  fireEvent.click(screen.getByTitle("发送"));
}

function modelSelect() {
  return within(screen.getByRole("complementary", { name: "模型配置" })).getAllByRole("combobox")[0];
}

function reply() {
  vi.mocked(streamPlaygroundChat).mockImplementation(async (_api, payload, _signal, onEvent) => {
    onEvent("message", { type: "delta", request_id: String(payload.model), delta: String(payload.model) + " response", received_at: new Date().toISOString(), mode: "stream" });
    onEvent("message", { type: "completed", request_id: String(payload.model), usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
  });
}

beforeEach(() => { vi.mocked(streamPlaygroundChat).mockReset(); });

it("sends the draft with Enter and clears the composer", async () => {
  reply();
  const user = userEvent.setup();
  render(<PlaygroundPanel api={api} data={fixture()} canViewRoutes={false} currentUserID="user" />);
  const input = screen.getByPlaceholderText("输入用于诊断模型的消息...");
  await user.type(input, "Keyboard question{Enter}");
  expect(await screen.findByText(modelA + " response")).toBeInTheDocument();
  expect(streamPlaygroundChat).toHaveBeenCalledOnce();
  expect(vi.mocked(streamPlaygroundChat).mock.calls[0][1].messages).toContainEqual({ role: "user", content: "Keyboard question" });
  expect(input).toHaveValue("");
});

it("inserts a newline with Shift+Enter and sends the multiline draft with Enter", async () => {
  reply();
  const user = userEvent.setup();
  render(<PlaygroundPanel api={api} data={fixture()} canViewRoutes={false} currentUserID="user" />);
  const input = screen.getByPlaceholderText("输入用于诊断模型的消息...");
  await user.type(input, "First line{Shift>}{Enter}{/Shift}Second line");
  expect(input).toHaveValue("First line\nSecond line");
  expect(streamPlaygroundChat).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(await screen.findByText(modelA + " response")).toBeInTheDocument();
  expect(vi.mocked(streamPlaygroundChat).mock.calls[0][1].messages).toContainEqual({ role: "user", content: "First line\nSecond line" });
});

it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }])("does not send on Enter when %j", (keyboardState) => {
  render(<PlaygroundPanel api={api} data={fixture()} canViewRoutes={false} currentUserID="user" />);
  const input = screen.getByPlaceholderText("输入用于诊断模型的消息...");
  fireEvent.change(input, { target: { value: "你好" } });
  fireEvent.keyDown(input, { key: "Enter", ...keyboardState });
  expect(streamPlaygroundChat).not.toHaveBeenCalled();
  expect(input).toHaveValue("你好");
});

it("does not send an empty draft with Enter", async () => {
  const user = userEvent.setup();
  render(<PlaygroundPanel api={api} data={fixture()} canViewRoutes={false} currentUserID="user" />);
  const input = screen.getByPlaceholderText("输入用于诊断模型的消息...");
  await user.type(input, "   {Enter}");
  expect(streamPlaygroundChat).not.toHaveBeenCalled();
  expect(input).toHaveValue("   ");
});

it.each(["admin", "team_leader", "user", "guest"])("uses the native single-model playground for %s with role-appropriate route visibility", async (role) => {
  reply();
  const user: AdminUser = { id: "user", username: "test", name: "Test", email: "test@example.com", role, status: "active" };
  const canViewRoutes = canAccessView(user, "routes");
  const data = fixture();
  if (!canViewRoutes) data.routes = [];
  render(<PlaygroundPage api={api} data={data} canViewRoutes={canViewRoutes} currentUserID="user" />);
  expect(screen.getByLabelText("选择 API Key")).toHaveValue("key");
  expect(screen.getByLabelText("系统提示")).toBeEnabled();
  expect(screen.queryByRole("button", { name: "添加对比模型" })).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "对比模型" })).not.toBeInTheDocument();
  expect(modelSelect()).toHaveTextContent(canViewRoutes ? modelA + " · 1 条路由" : modelA);
  if (!canViewRoutes) expect(modelSelect()).not.toHaveTextContent("条路由");
  send("First question");
  expect(await screen.findByText(modelA + " response")).toBeInTheDocument();
  expect(streamPlaygroundChat).toHaveBeenCalledOnce();
  expect(vi.mocked(streamPlaygroundChat).mock.calls[0][1]).toMatchObject({
    model: modelA, api_key_id: "key", max_tokens: 4096, temperature: 0.7, top_p: 1,
    messages: expect.arrayContaining([{ role: "user", content: "First question" }]),
  });
  expect(vi.mocked(streamPlaygroundChat).mock.calls[0][1]).not.toHaveProperty("project_id");
});

it.each([
  { state: "missing", keys: [] },
  { state: "disabled", keys: [playgroundKey("key", "Key", { status: "disabled" })] },
  { state: "owned by another user", keys: [playgroundKey("key", "Key", { owner_user_id: "someone-else" })] },
])("requires an active key of the current user when the key is $state", ({ keys }) => {
  const data = fixture();
  data.keys = keys;
  const onCreateKey = vi.fn();
  render(<PlaygroundPanel api={api} data={data} canViewRoutes={false} currentUserID="user" onCreateKey={onCreateKey} />);
  expect(screen.getByLabelText("选择 API Key")).toBeDisabled();
  expect(screen.getByRole("option", { name: "暂无可用 API Key" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("输入用于诊断模型的消息...")).toBeDisabled();
  expect(screen.getByTitle("发送")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "去创建 API Key" }));
  expect(onCreateKey).toHaveBeenCalledOnce();
  expect(streamPlaygroundChat).not.toHaveBeenCalled();
});

it("sends subsequent turns with the selected key, system prompt and conversation history", async () => {
  reply();
  const data = fixture();
  data.keys.push(playgroundKey("second-key", "Second key"));
  render(<PlaygroundPanel api={api} data={data} canViewRoutes={false} currentUserID="user" />);
  fireEvent.change(screen.getByLabelText("选择 API Key"), { target: { value: "second-key" } });
  fireEvent.change(screen.getByLabelText("系统提示"), { target: { value: "Custom system prompt" } });
  send("First question");
  await screen.findByText(modelA + " response");
  send("Follow up");
  await waitFor(() => expect(streamPlaygroundChat).toHaveBeenCalledTimes(2));
  expect(vi.mocked(streamPlaygroundChat).mock.calls[1][1]).toMatchObject({
    model: modelA, api_key_id: "second-key", messages: [
      { role: "system", content: "Custom system prompt" },
      { role: "user", content: "First question" },
      { role: "assistant", content: modelA + " response" },
      { role: "user", content: "Follow up" },
    ],
  });
});

it.each([true, false])("switches models with keepContext=%s and applies the new model's parameter limits", async (keepContext) => {
  reply();
  render(<PlaygroundPanel api={api} data={fixture()} canViewRoutes={false} currentUserID="user" />);
  send("First question");
  await screen.findByText(modelA + " response");
  fireEvent.change(modelSelect(), { target: { value: modelB } });
  fireEvent.click(screen.getByRole("button", { name: keepContext ? "保留上下文继续" : "新建会话并切换" }));
  send("New model question");
  await screen.findByText(modelB + " response");
  const payload = vi.mocked(streamPlaygroundChat).mock.calls[1][1];
  expect(payload).toMatchObject({ model: modelB, max_tokens: 512, temperature: 0.7 });
  expect(payload).not.toHaveProperty("top_p");
  const history = payload.messages as { role: string; content: string }[];
  expect(history.some((message) => message.content === modelA + " response")).toBe(keepContext);
});

it("stops the active stream and restores the single-model composer", async () => {
  vi.mocked(streamPlaygroundChat).mockImplementation((_api, _payload, signal) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  render(<PlaygroundPanel api={api} data={fixture()} canViewRoutes={false} currentUserID="user" />);
  send("Long response");
  expect(streamPlaygroundChat).toHaveBeenCalledOnce();
  expect(modelSelect()).toBeDisabled();
  fireEvent.click(screen.getByTitle("停止生成"));
  await waitFor(() => expect(screen.queryByTitle("停止生成")).not.toBeInTheDocument());
  expect(vi.mocked(streamPlaygroundChat).mock.calls[0][2].aborted).toBe(true);
  expect(screen.getByPlaceholderText("输入用于诊断模型的消息...")).toBeEnabled();
});

it("clears the conversation before starting a new request", async () => {
  reply();
  render(<PlaygroundPanel api={api} data={fixture()} canViewRoutes={false} currentUserID="user" />);
  send("Discard this history");
  await screen.findByText(modelA + " response");
  fireEvent.click(screen.getByRole("button", { name: "清空历史" }));
  expect(screen.queryByText("Discard this history")).not.toBeInTheDocument();
  send("Fresh question");
  await waitFor(() => expect(streamPlaygroundChat).toHaveBeenCalledTimes(2));
  expect(vi.mocked(streamPlaygroundChat).mock.calls[1][1].messages).toEqual([
    { role: "system", content: expect.any(String) }, { role: "user", content: "Fresh question" },
  ]);
});
