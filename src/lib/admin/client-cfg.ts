import type { ContentCfg } from "./content-config";
import type { ClientCfg } from "@/components/admin/ContentForm";

/** Strips functions (not serialisable to client components). */
export const clientCfg = (cfg: ContentCfg): ClientCfg => {
  const { publicPath, ...rest } = cfg; void publicPath;
  return rest;
};
