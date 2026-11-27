import { afterEach, expect, it } from "vitest";
import { emptyData } from "./catalog";
import { providerResourceAuditLabel } from "./entities";
import { setActiveLanguage } from "../i18n/runtime";

afterEach(() => setActiveLanguage("zh-CN"));
it("labels only the unassigned bucket without hiding real resource identifiers", () => {
  const data = emptyData();
  expect(providerResourceAuditLabel(data, "unknown")).toBe("未关联资源账号");
  expect(providerResourceAuditLabel(data, "rsrc_archived")).toBe("rsrc_archived");
  expect(providerResourceAuditLabel(data, "")).toBe("-");
});
it.each(["en", "ja", "ru"] as const)("localizes the unassigned bucket in %s", language => {
  setActiveLanguage(language);
  const label = providerResourceAuditLabel(emptyData(), "unknown");
  expect(label).not.toBe("unknown");
  expect(label).not.toBe("未关联资源账号");
});
