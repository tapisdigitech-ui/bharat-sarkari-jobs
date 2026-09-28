/** Official updates chain for a public record (facade over the data port). */
import "server-only";
import type { OfficialUpdate, OfficialUpdateKind } from "@/lib/gov-types";
import { port } from "./port";

export async function officialUpdatesFor(kind: OfficialUpdateKind, contentId: string | undefined | null): Promise<OfficialUpdate[]> {
  if (!contentId) return [];
  return port().officialUpdates(kind, contentId);
}
