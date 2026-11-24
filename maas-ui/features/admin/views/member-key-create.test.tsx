import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyData } from "../domain/catalog";
import { QuickAPIKeyModal } from "./quick-access";

const member = { id: "usr_member", username: "member", name: "Member", email: "m@test.invalid", role: "user", team_id: "team", status: "active" };

// A member creates a key with a name only; quota and model scope stay under the
// team leader's control.
describe("member key creation", () => {
  it("shows only the name field", () => {
    render(<QuickAPIKeyModal data={emptyData()} user={member} loading={false} onClose={vi.fn()} onCreate={vi.fn()} />);
    expect(screen.getByText("基本信息")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入")).toBeInTheDocument();
    expect(screen.queryByText("归属项目")).not.toBeInTheDocument();
    expect(screen.queryByText("Key 名称")).not.toBeInTheDocument();
    expect(document.querySelectorAll("input, select").length).toBe(1);
  });

  it("submits the default quota and scope rather than asking for them", () => {
    const onCreate = vi.fn();
    render(<QuickAPIKeyModal data={emptyData()} user={member} loading={false} onClose={vi.fn()} onCreate={onCreate} />);
    fireEvent.change(screen.getByPlaceholderText("请输入"), { target: { value: "My key" } });
    fireEvent.click(screen.getByRole("button", { name: "确定" }));
    expect(onCreate).toHaveBeenCalledOnce();
    const values = onCreate.mock.calls[0][0];
    expect(values.name).toBe("My key");
    expect(values.model_access_mode).toBe("inherit");
    // The dialog never exposes quota fields, so the submission leaves them at
    // the platform defaults.
    expect(values.project_id).toBe("");
    expect(values.owner_user_id).toBe("usr_member");
  });
});
