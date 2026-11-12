import { type ComponentProps } from "react";
import { SvgIcon } from "../../../components/svg-icon";
import { type Provider } from "../core/types";
import { tx } from "../i18n/runtime";
import { CrudView } from "./crud-projects";

// Keep the upstream view contract intact; this wrapper only supplies the portal heading and styles.
export function ProviderChannelView(props: ComponentProps<typeof CrudView<Provider>>) {
  return (
    <section className="provider-channel-view" aria-labelledby="provider-channel-title">
      <div className="provider-channel-title">
        <SvgIcon name="overview-icon" size={16} />
        <h1 id="provider-channel-title">{tx("Provider 渠道")}</h1>
      </div>

      <div className="provider-channel-panel">
        <CrudView {...props} />
      </div>
    </section>
  );
}
