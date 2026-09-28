/** Official-vs-Expected date rules, shared by the job validator and the content validator (mirrors add_date_status() CHECKs in the database). */
export type DateStatus = "official" | "expected";
export type DateProblem = { field: "date" | "status" | "text"; message: string };

export function checkDateStatus(date: string | undefined | null, status: string | undefined | null, text: string | undefined | null, label = "This date"): DateProblem | null {
  if (!status) {
    if (date || text) return { field: "status", message: "Say whether this date is Official or Expected" };
    return null;
  }
  if (status !== "official" && status !== "expected") return { field: "status", message: "Choose Official or Expected" };
  if (status === "official") {
    if (!date) return { field: "date", message: `${label}: an official date needs the exact date` };
    if (text) return { field: "text", message: "Expected wording is only for expected dates" };
  } else if (!date && !text) return { field: "text", message: "Give an expected date or wording such as “October 2026”" };
  if (text && text.length > 60) return { field: "text", message: "At most 60 characters" };
  return null;
}
