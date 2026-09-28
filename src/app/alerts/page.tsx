import { AlertCard } from "@/components/home/AlertCard";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { buildMetadata } from "@/lib/seo/metadata";

export const metadata = buildMetadata({ title: "Job Alerts", description: "Get government job alerts by state, qualification and department (coming soon).", path: "/alerts", noindex: true });

export default function AlertsPage() {
  return (
    <div className="container-page py-6 md:py-8">
      <Breadcrumbs items={[{ name: "Job Alerts", href: "/alerts" }]} />
      <div className="mt-5"><AlertCard /></div>
    </div>
  );
}
