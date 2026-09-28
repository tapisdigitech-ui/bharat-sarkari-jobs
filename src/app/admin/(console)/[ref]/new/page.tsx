import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can, type Action } from "@/lib/admin/permissions";
import { contentCfgByRoute } from "@/lib/admin/content-config";
import { contentOptions } from "@/lib/admin/content-options";
import { ContentForm } from "@/components/admin/ContentForm";
import { clientCfg } from "@/lib/admin/client-cfg";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ ref: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { const c = contentCfgByRoute((await params).ref); return { title: c ? `New ${c.label.toLowerCase()}` : "Not found" }; }

export default async function NewContent({ params }: Props) {
  const cfg = contentCfgByRoute((await params).ref);
  if (!cfg) notFound();
  await requireStaff(`${cfg.kind}:create` as Action);
  return (
    <div className="space-y-5">
      <div><Link href={`/admin/${cfg.route}`} className="text-sm text-brand-700 underline">← All {cfg.plural.toLowerCase()}</Link><h1 className="mt-1 text-2xl font-extrabold">New {cfg.label.toLowerCase()}</h1><p className="mt-1 max-w-3xl text-sm text-ink-muted">{cfg.intro}</p></div>
      <ContentForm cfg={clientCfg(cfg)} options={await contentOptions()} initial={{}} sourceCheckedAt={null} canSave canSubmit={true} canPublish={false} />
    </div>
  );
}
