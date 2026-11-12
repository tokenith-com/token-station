import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useState } from "react";
import { emptyData } from "../domain/catalog";
import { adminFetch } from "../resources/payloads";
import { modelConfig } from "../resources/provider-model-config";
import { ModelCreateDialog } from "./model-create-dialog";
import { ModalErrorProvider } from "../shared/modal-error";

vi.mock("../resources/payloads", async (importOriginal) => ({
  ...await importOriginal<typeof import("../resources/payloads")>(),
  adminFetch: vi.fn(),
}));
vi.mock("./model-create-modal", () => ({
  ModelCreateModal: ({ onSave }: { onSave: (form: Record<string, string>) => void }) => <button onClick={() => onSave({
    name: "priced-rerank", display_name: "Rerank display", modality: "rerank", status: "active",
    initial_provider_models: "provider|upstream", search_unit_price_usd: "0.002", retrieval_pricing_confirmed: "true",
    cache_read_price_usd_per_1m: "0", cache_write_price_usd_per_1m: "0.5",
  })}>Create</button>,
}));

it("posts the selected upstream mapping without discarding retrieval pricing metadata", async () => {
  vi.mocked(adminFetch).mockResolvedValue(new Response("{}", { status: 201 }));
  const data = emptyData();
  data.providers = [{ id: "provider", name: "Provider", type: "openai_compatible", status: "active", priority: 100, healthy: true, base_url: "https://example.test" }];
  data.providerModels = [{ id: "upstream", provider_id: "provider", upstream_model: "upstream", status: "active" }];
  const onSaved = vi.fn();
  render(<ModelCreateDialog api={{ baseURL: "", adminToken: "test" }} config={modelConfig()} data={data}
    loading={false} onClose={() => {}} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const [api, path, options] = vi.mocked(adminFetch).mock.calls[0];
  expect(api.adminToken).toBe("test");
  expect(path).toBe("/api/admin/models");
  expect(options?.method).toBe("POST");
  const payload = JSON.parse(options?.body as string);
  expect(payload.metadata).toMatchObject({ source: "manual-external", directory_role: "external", title: "Rerank display",
    search_unit_price_usd: "0.002", retrieval_pricing_confirmed: "true", cache_read_price_configured: "true" });
  expect(payload.routes).toEqual([expect.objectContaining({ provider_id: "provider", provider_model: "upstream", model_name: "priced-rerank" })]);
});

it.each([400, 500, "network"] as const)("closes the model dialog and reports an API %s failure on the page", async (failure) => {
  vi.mocked(adminFetch).mockReset();
  if (failure === "network") vi.mocked(adminFetch).mockRejectedValue(new Error("Network unavailable"));
  else vi.mocked(adminFetch).mockResolvedValue(new Response(JSON.stringify({ error: { message: "Model creation rejected" } }), { status: failure }));
  const data = emptyData();
  data.providers = [{ id: "provider", name: "Provider", type: "openai_compatible", status: "active", priority: 100, healthy: true, base_url: "https://example.test" }];
  data.providerModels = [{ id: "upstream", provider_id: "provider", upstream_model: "upstream", status: "active" }];
  function Page() {
    const [open, setOpen] = useState(true);
    const [error, setError] = useState("");
    return <ModalErrorProvider onError={(reason, fallback) => setError(reason instanceof Error ? reason.message : fallback)}>
      {error ? <p role="alert">{error}</p> : null}
      {open ? <ModelCreateDialog api={{ baseURL: "", adminToken: "test" }} config={modelConfig()} data={data}
        loading={false} onClose={() => setOpen(false)} onSaved={vi.fn()} /> : null}
    </ModalErrorProvider>;
  }
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument());
  expect(screen.getByRole("alert")).toHaveTextContent(failure === "network" ? "Network unavailable" : "Model creation rejected");
});

it("keeps the model dialog open for local validation without making a request", () => {
  vi.mocked(adminFetch).mockReset();
  const onClose = vi.fn();
  render(<ModelCreateDialog api={{ baseURL: "", adminToken: "test" }} config={modelConfig()} data={emptyData()}
    loading={false} onClose={onClose} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(adminFetch).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
});
