import { describe, expect, it } from "vitest";
import { identityProviderInitialFormValues } from "./auth";

describe("identity provider initial values", () => {
  it.each(["tokenstation-admin", "tokenhub-admin"])("clears the %s example only when creating", (clientID) => {
    const values = { provider_type: "oidc", issuer_url: "https://sso.example.com", client_id: clientID };
    expect(identityProviderInitialFormValues(values, true)).toMatchObject({ issuer_url: "", client_id: "" });
    expect(identityProviderInitialFormValues(values, false)).toMatchObject(values);
    expect(values.client_id).toBe(clientID);
  });

  it("preserves custom client IDs when creating", () => {
    expect(identityProviderInitialFormValues({ client_id: "company-admin" }, true).client_id).toBe("company-admin");
  });
});
