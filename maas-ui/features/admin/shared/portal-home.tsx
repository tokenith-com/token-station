import { type ReactNode } from "react";
import { type AppLanguage } from "../i18n/runtime";
import { LoginDesignPreview } from "./login-design-preview";

type PortalHomeProps = {
  theme: "light" | "dark";
  language: AppLanguage;
  onThemeToggle: () => void;
  onLanguageChange: (language: AppLanguage) => void;
  children: ReactNode;
};

export function PortalHome(props: PortalHomeProps) {
  return <LoginDesignPreview {...props} />;
}
