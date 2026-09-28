import type { Department, Qualification, State } from "@/lib/types";

/** Reference data (real, stable facts: administrative units). Not job data. */
export const states: State[] = [
  { slug: "andhra-pradesh", name: "Andhra Pradesh", kind: "state", code: "AP" },
  { slug: "arunachal-pradesh", name: "Arunachal Pradesh", kind: "state", code: "AR" },
  { slug: "assam", name: "Assam", kind: "state", code: "AS" },
  { slug: "bihar", name: "Bihar", kind: "state", code: "BR" },
  { slug: "chhattisgarh", name: "Chhattisgarh", kind: "state", code: "CG" },
  { slug: "goa", name: "Goa", kind: "state", code: "GA" },
  { slug: "gujarat", name: "Gujarat", kind: "state", code: "GJ" },
  { slug: "haryana", name: "Haryana", kind: "state", code: "HR" },
  { slug: "himachal-pradesh", name: "Himachal Pradesh", kind: "state", code: "HP" },
  { slug: "jharkhand", name: "Jharkhand", kind: "state", code: "JH" },
  { slug: "karnataka", name: "Karnataka", kind: "state", code: "KA" },
  { slug: "kerala", name: "Kerala", kind: "state", code: "KL" },
  { slug: "madhya-pradesh", name: "Madhya Pradesh", kind: "state", code: "MP" },
  { slug: "maharashtra", name: "Maharashtra", kind: "state", code: "MH" },
  { slug: "manipur", name: "Manipur", kind: "state", code: "MN" },
  { slug: "meghalaya", name: "Meghalaya", kind: "state", code: "ML" },
  { slug: "mizoram", name: "Mizoram", kind: "state", code: "MZ" },
  { slug: "nagaland", name: "Nagaland", kind: "state", code: "NL" },
  { slug: "odisha", name: "Odisha", kind: "state", code: "OD" },
  { slug: "punjab", name: "Punjab", kind: "state", code: "PB" },
  { slug: "rajasthan", name: "Rajasthan", kind: "state", code: "RJ" },
  { slug: "sikkim", name: "Sikkim", kind: "state", code: "SK" },
  { slug: "tamil-nadu", name: "Tamil Nadu", kind: "state", code: "TN" },
  { slug: "telangana", name: "Telangana", kind: "state", code: "TS" },
  { slug: "tripura", name: "Tripura", kind: "state", code: "TR" },
  { slug: "uttar-pradesh", name: "Uttar Pradesh", kind: "state", code: "UP" },
  { slug: "uttarakhand", name: "Uttarakhand", kind: "state", code: "UK" },
  { slug: "west-bengal", name: "West Bengal", kind: "state", code: "WB" },
  { slug: "andaman-and-nicobar-islands", name: "Andaman & Nicobar Islands", kind: "ut", code: "AN" },
  { slug: "chandigarh", name: "Chandigarh", kind: "ut", code: "CH" },
  { slug: "dadra-and-nagar-haveli-and-daman-and-diu", name: "Dadra & Nagar Haveli and Daman & Diu", kind: "ut", code: "DD" },
  { slug: "delhi", name: "Delhi", kind: "ut", code: "DL" },
  { slug: "jammu-and-kashmir", name: "Jammu & Kashmir", kind: "ut", code: "JK" },
  { slug: "ladakh", name: "Ladakh", kind: "ut", code: "LA" },
  { slug: "lakshadweep", name: "Lakshadweep", kind: "ut", code: "LD" },
  { slug: "puducherry", name: "Puducherry", kind: "ut", code: "PY" },
];

export const departments: Department[] = [
  { slug: "upsc", name: "UPSC", short: "UPSC", description: "Central civil services and specialist recruitment through the Union Public Service Commission." },
  { slug: "ssc", name: "SSC", short: "SSC", description: "Group B and C central government posts recruited through the Staff Selection Commission." },
  { slug: "railways", name: "Railways", short: "Rail", description: "Recruitment across railway zones, production units and railway recruitment boards." },
  { slug: "banking", name: "Banking", short: "Bank", description: "Public sector bank, RBI, NABARD and other banking-sector recruitment." },
  { slug: "defence", name: "Defence", short: "Defence", description: "Army, Navy, Air Force, paramilitary and Ministry of Defence civilian recruitment." },
  { slug: "police", name: "Police", short: "Police", description: "State police, central armed police forces and related security recruitment." },
  { slug: "teaching", name: "Teaching", short: "Teaching", description: "School, college and university teaching and non-teaching recruitment." },
  { slug: "state-psc", name: "State PSC", short: "State PSC", description: "State Public Service Commission and subordinate service selection board recruitment." },
  { slug: "health", name: "Health", short: "Health", description: "Government hospitals, medical colleges and public health department recruitment." },
  { slug: "courts", name: "Courts", short: "Courts", description: "High Court, district court and tribunal recruitment." },
  { slug: "psu", name: "PSU", short: "PSU", description: "Public sector undertakings and central/state government companies." },
  { slug: "universities", name: "Universities", short: "Univ.", description: "Central and state university recruitment, teaching and non-teaching." },
  { slug: "municipal", name: "Municipal", short: "Municipal", description: "Municipal corporation, council and urban local body recruitment." },
  { slug: "panchayat", name: "Panchayat", short: "Panchayat", description: "Gram panchayat, block and zila parishad level recruitment." },
  { slug: "anganwadi", name: "Anganwadi", short: "Anganwadi", description: "Anganwadi worker, helper and supervisor recruitment under ICDS." },
  { slug: "nhm", name: "NHM", short: "NHM", description: "National Health Mission contractual and regular health posts." },
  { slug: "other", name: "Other Departments", short: "Other", description: "Recruitment by departments that are not covered by the categories above." },
];

export const qualifications: Qualification[] = [
  { slug: "10th-pass", name: "10th Pass", pageTitle: "10th Pass Government Jobs", rank: 1, description: "Government jobs open to candidates who have passed Class 10 (Matriculation/SSLC)." },
  { slug: "12th-pass", name: "12th Pass", pageTitle: "12th Pass Government Jobs", rank: 2, description: "Government jobs open to candidates who have passed Class 12 (Intermediate/HSC)." },
  { slug: "iti", name: "ITI", pageTitle: "ITI Government Jobs", rank: 3, description: "Government jobs and apprenticeships for ITI certificate holders." },
  { slug: "diploma", name: "Diploma", pageTitle: "Diploma Government Jobs", rank: 4, description: "Government jobs for polytechnic and other diploma holders." },
  { slug: "graduate", name: "Graduate", pageTitle: "Graduate Government Jobs", rank: 5, description: "Government jobs open to candidates with a bachelor's degree in any stream." },
  { slug: "post-graduate", name: "Post Graduate", pageTitle: "Post Graduate Government Jobs", rank: 6, description: "Government jobs requiring a master's degree or higher." },
  { slug: "engineering", name: "Engineering", pageTitle: "Engineering Government Jobs", rank: 7, description: "Government jobs for B.E./B.Tech and engineering diploma holders." },
  { slug: "medical", name: "Medical", pageTitle: "Medical Government Jobs", rank: 8, description: "Government jobs for doctors, nurses, pharmacists and allied health professionals." },
  { slug: "law", name: "Law", pageTitle: "Law Government Jobs", rank: 9, description: "Government jobs for law graduates: legal officers, judicial services and court posts." },
  { slug: "teaching", name: "Teaching (B.Ed/D.El.Ed)", pageTitle: "Teaching Government Jobs", rank: 10, description: "Government teaching posts for candidates with B.Ed, D.El.Ed, TET or equivalent." },
];

export const stateBySlug = (slug: string) => states.find((s) => s.slug === slug);
export const departmentBySlug = (slug: string) => departments.find((d) => d.slug === slug);
export const qualificationBySlug = (slug: string) => qualifications.find((q) => q.slug === slug);
