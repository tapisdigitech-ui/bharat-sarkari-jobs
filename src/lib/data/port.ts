/** Chooses the data source. The ONLY place that knows both implementations exist. */
import "server-only";
import { dataSource } from "@/lib/env";
import type { ContentPort } from "./ports";
import { demoPort } from "./demo/port";
import { supabasePort } from "./supabase/port";

export const port = (): ContentPort => (dataSource() === "supabase" ? supabasePort : demoPort);
