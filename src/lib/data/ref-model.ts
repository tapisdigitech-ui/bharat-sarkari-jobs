/** Reference-data shapes shared by both data sources. */
import type { Department, Qualification, State } from "@/lib/types";

export interface RefData {
  /** Active rows only — for pickers, navigation, filters and sitemaps. */
  states: State[]; departments: Department[]; qualifications: Qualification[];
  /** Every row, including archived — for resolving names of historical records. */
  allStates: State[]; allDepartments: Department[]; allQualifications: Qualification[];
}

export const buildRefData = (allStates: State[], allDepartments: Department[], allQualifications: Qualification[]): RefData => ({
  allStates, allDepartments, allQualifications,
  states: allStates.filter((x) => x.isActive !== false),
  departments: allDepartments.filter((x) => x.isActive !== false),
  qualifications: allQualifications.filter((x) => x.isActive !== false),
});
