import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { ModalErrorProvider, useModalError } from "./modal-error";

function RequestButton({ error }: { error: unknown }) {
  const closeOnError = useModalError();
  return <button onClick={() => closeOnError(error, "请求失败")}>发起请求</button>;
}

it("closes the current dialog and keeps its save error visible on the page", () => {
  function Page() {
    const [open, setOpen] = useState(true);
    const [error, setError] = useState("");
    return <ModalErrorProvider onError={(reason, fallback) => setError(reason instanceof Error ? reason.message : fallback)}>
      {error ? <p role="alert">{error}</p> : null}
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </ModalErrorProvider>;
  }
  function Dialog({ onClose }: { onClose: () => void }) {
    return <ModalErrorProvider onClose={onClose}>
      <div role="dialog"><RequestButton error={new Error("接口返回 500")} /></div>
    </ModalErrorProvider>;
  }
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "发起请求" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("接口返回 500");
});

it("closes only the nested dialog whose save failed", () => {
  const parentClose = vi.fn();
  const report = vi.fn();
  function NestedDialog() {
    const [open, setOpen] = useState(true);
    const closeOnError = useModalError(() => setOpen(false));
    return open ? <div role="dialog" aria-label="nested"><button onClick={() => closeOnError(new Error("save failed"), "保存失败")}>保存</button></div> : null;
  }
  render(<ModalErrorProvider onError={report}>
    <ModalErrorProvider onClose={parentClose}><div role="dialog" aria-label="parent"><NestedDialog /></div></ModalErrorProvider>
  </ModalErrorProvider>);
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.queryByRole("dialog", { name: "nested" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "parent" })).toBeInTheDocument();
  expect(parentClose).not.toHaveBeenCalled();
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "save failed" }), "保存失败");
});

it("ignores cancelled requests", () => {
  const report = vi.fn();
  const close = vi.fn();
  render(<ModalErrorProvider onError={report} onClose={close}><RequestButton error={new DOMException("cancelled", "AbortError")} /></ModalErrorProvider>);
  fireEvent.click(screen.getByRole("button", { name: "发起请求" }));
  expect(report).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});
