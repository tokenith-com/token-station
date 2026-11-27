import { useCustomerTerminology } from "../i18n/customer-copy";
import { Clock3 } from "lucide-react";
import { tx } from "../i18n/runtime";

export function PendingPageView({ title }: { title: string }) {
  const ui = useCustomerTerminology();
  return (
    <div className="resource-empty">
      <div className="resource-empty-icon" aria-hidden="true">
        <Clock3 size={18} />
      </div>
      <strong>{ui(title)}</strong>
      <span>{tx("页面内容待更新")}</span>
    </div>
  );
}
