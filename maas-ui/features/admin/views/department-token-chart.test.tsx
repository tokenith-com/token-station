import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DepartmentTokenChart } from "./department-token-chart";

const rows = [{ id: "a", name: "Synthetic Long Department Name", request_count: 2, input_tokens: 800, output_tokens: 200, total_tokens: 1000, estimated_cost_usd: 0 }, { id: "b", name: "Output Only", request_count: 1, input_tokens: 0, output_tokens: 1200, total_tokens: 1200, estimated_cost_usd: 0 }];
it("sorts departments without mutating data and exposes exact values on focus", () => {
  const { container } = render(<DepartmentTokenChart rows={rows} />);
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Output Only");
  expect(rows[0].id).toBe("a");
  fireEvent.focus(container.querySelector('[tabindex="0"]')!);
  expect(screen.getByRole("tooltip")).toHaveTextContent("1,200");
  fireEvent.click(screen.getByText("查看数据表"));
  expect(screen.getByRole("table")).toHaveTextContent("Synthetic Long Department Name");
  expect(container.querySelector('.is-input[style*="0%"]')).not.toBeNull();
});
it("shows an honest empty state", () => {
  render(<DepartmentTokenChart rows={[]} />);
  expect(screen.getByText("暂无客户团队 Token 数据")).toBeInTheDocument();
});
