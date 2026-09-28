import "server-only";

interface DbError { code?: string; message?: string; details?: string | null }

/**
 * Turns a database error into a message that is safe and useful to show an editor.
 * Our own triggers/RPCs raise human-readable messages (SQLSTATE 42501 not-permitted, 23514 rule violated, 23505 duplicate),
 * which are passed through. Anything unexpected is logged on the server and replaced with a generic message.
 */
export function dbMessage(err: DbError, fallback = "Something went wrong. Nothing was changed. Please try again."): string {
  const msg = (err.message ?? "").trim();
  switch (err.code) {
    case "42501": return msg && !/row-level security|permission denied/i.test(msg) ? msg : "You do not have permission to do that.";
    case "23514": return msg.replace(/^new row for relation "\w+" violates check constraint "(\w+)".*$/i, (_m, c) => `A value failed a database rule (${c}). Check the fields and try again.`).slice(0, 400);
    case "23505": return /slug/i.test(msg + (err.details ?? "")) ? "That URL slug is already used by another job. Choose a different one." : "That value already exists.";
    case "P0001": return msg.slice(0, 400) || fallback;
    case "23503": return "Other records still depend on this (or it points to something that does not exist). Archive it instead of deleting it, or fix the reference.";
    case "22007": case "22008": return "One of the dates is not valid.";
    case "22P02": return "One of the values has an invalid format.";
    default:
      console.error("[admin] unexpected database error", err.code, msg);
      return fallback;
  }
}
