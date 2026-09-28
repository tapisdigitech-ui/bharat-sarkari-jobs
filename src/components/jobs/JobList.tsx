import type { Job } from "@/lib/types";
import { AdSlot } from "@/components/ui/AdSlot";
import { JobCard } from "./JobCard";

export function JobList({ jobs, adEvery = 6 }: { jobs: Job[]; adEvery?: number }) {
  return (
    <ul className="grid gap-3 md:gap-4">
      {jobs.map((j, i) => (
        <li key={j.id}>
          <JobCard job={j} headingAs="h2" />
          {(i + 1) % adEvery === 0 && i < jobs.length - 1 && <AdSlot placement="list-inline" className="mt-3" />}
        </li>
      ))}
    </ul>
  );
}
