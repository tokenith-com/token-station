import { AdminConsole } from "./admin-console";
import { readRuntimeConfig } from "@/lib/runtime-config";

export function AdminConsoleBoot() {
  return <AdminConsole defaultBaseURL={readRuntimeConfig().apiBaseURL} />;
}
