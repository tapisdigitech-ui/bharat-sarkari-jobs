import type { Job } from "@/lib/types";
import { daysBetween, todayIST } from "@/lib/dates";

export const locationLabel = (j: Job) => {
  const base = j.stateSlug === "all-india" ? "All India" : j.stateName ?? j.stateSlug;
  return j.districtName ? `${j.districtName}, ${base}` : base;
};

export const qualificationLabel = (j: Job) =>
  (j.qualificationNames ?? j.qualificationSlugs).join(" / ");

export const vacancyLabel = (n: number | null) => (n === null ? "Not specified" : `${n.toLocaleString("en-IN")} Posts`);

export const isNew = (j: Job) => daysBetween(j.postedAt, todayIST()) <= 3;
export const levelLabel: Record<Job["level"], string> = {
  central: "Central", state: "State", district: "District", municipal: "Municipal", panchayat: "Panchayat", psu: "PSU",
};
