import { type ComponentProps } from "react";
import { type Provider } from "../core/types";
import { CrudView } from "./crud-projects";

// Keep the upstream view contract intact; this wrapper only supplies the portal heading and styles.
export function ProviderChannelView(props: ComponentProps<typeof CrudView<Provider>>) {
  return (
    <section className="provider-channel-view">
      <div className="provider-channel-panel">
        <CrudView {...props} />
      </div>
    </section>
  );
}
