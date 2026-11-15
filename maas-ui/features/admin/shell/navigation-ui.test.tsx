import { render, screen, fireEvent, act } from "@testing-library/react";
import { SidebarNavItem } from "./sidebar-nav-item";
import { describe, expect, it, vi } from "vitest";
import { pageHeaderChips, Sidebar } from "./navigation-ui";
import { expectedMenus } from "../core/navigation.test";
import { navGroupsForUser, isNavParentItem } from "../core/navigation";
import type { AdminUser, AppRole } from "../core/types";
import { emptyData } from "../domain/catalog";
describe("current sidebar after 0.9 merge", () => {
  it.each([false, true])("handles focus scrolling and pending Escape cancellation: %s", escape => {
    let frame: FrameRequestCallback | undefined;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frame = callback; return 42; });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => { frame = undefined; });
    const { unmount } = render(<SidebarNavItem active={false} collapsed label="Overview" onSelect={vi.fn()}>Icon</SidebarNavItem>);
    const button = screen.getByRole("button", { name: "Overview" });
    const matches = vi.spyOn(button, "matches").mockReturnValue(true);
    act(() => button.focus());
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    if (escape) {
      fireEvent.keyDown(button, { key: "Escape" });
      expect(cancel).toHaveBeenCalledWith(42);
      expect(frame).toBeUndefined();
    } else {
      act(() => frame!(0));
      expect(screen.getByRole("tooltip")).toHaveTextContent("Overview");
      fireEvent.scroll(window);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    }
    unmount();
    matches.mockRestore();
    request.mockRestore();
    cancel.mockRestore();
  });
  it.each(Object.keys(expectedMenus) as AppRole[])("renders the retained %s menu and selects pages", role => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const user: AdminUser = { id: role, username: role, name: role, email: "", role, status: "active" };
    const onSelect = vi.fn();
    render(<Sidebar activeView="overview" user={user} onSelect={onSelect} collapsed={false} onToggleCollapse={vi.fn()} openGroups={{}} onToggleGroup={vi.fn()} />);
    expect(screen.getByText("TokenStation")).toBeInTheDocument();
    const items = navGroupsForUser(user).flatMap(g => g.items.flatMap(i => isNavParentItem(i) ? i.children : [i]));
    for (const item of items) {
      fireEvent.click(screen.getByRole("button", { name: item.label }));
      expect(onSelect).toHaveBeenLastCalledWith(item.view);
    }
    if (role !== "admin") expect(screen.queryByRole("button", { name: "供应商" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /版本|^v/ })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("counts enabled providers without treating configuration health as an observation", () => {
    const data = emptyData();
    data.providers = [
      { id: "enabled", name: "Enabled provider", type: "mock", priority: 1, status: "active", healthy: false },
      { id: "disabled", name: "Disabled provider", type: "mock", priority: 2, status: "disabled", healthy: true },
    ];
    const admin: AdminUser = { id: "admin", username: "admin", name: "Admin", email: "", role: "admin", status: "active" };
    expect(pageHeaderChips("providers", data, admin)).toContainEqual({ label: "已启用供应商", value: "1/2" });
    expect(pageHeaderChips("providers", data, admin).some(chip => chip.label === "健康 Provider")).toBe(false);
  });
});
