// Date helpers. The API uses two formats:
//   dates      "2026-11-20"             (applied_date, deadline, ...)
//   date-times "2026-11-25T10:30:00Z"   (interview scheduled_at, in UTC)
// Everything shown to the user is converted to their local time zone.

const pad = (number) => String(number).padStart(2, "0");

// Date object -> "YYYY-MM-DD" in LOCAL time. (toISOString() would use UTC,
// which gives yesterday's date early in the morning in India.)
export const toISODate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const todayISO = () => toISODate(new Date());

// "2026-11-20" -> Date at local midnight.
export const parseISODate = (isoDate) => new Date(`${isoDate}T00:00:00`);

export const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

// Whole days from today to the given date (negative = in the past).
export const daysFromToday = (isoDate) =>
  Math.round((parseISODate(isoDate) - parseISODate(todayISO())) / 86400000);

export const formatDate = (isoDate) =>
  isoDate
    ? parseISODate(isoDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

export const formatTime = (isoDateTime) =>
  new Date(isoDateTime).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

export const formatDateTime = (isoDateTime) =>
  isoDateTime
    ? `${formatDate(toISODate(new Date(isoDateTime)))}, ${formatTime(isoDateTime)}`
    : "—";

// "Today", "Tomorrow", "In 3 days", "2 days ago"
export const relativeDay = (isoDate) => {
  const days = daysFromToday(isoDate);

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";

  return days > 0 ? `In ${days} days` : `${-days} days ago`;
};

// UTC date-time from the API -> value for <input type="datetime-local">.
export const toDatetimeLocal = (isoDateTime) => {
  if (!isoDateTime) return "";

  const date = new Date(isoDateTime);

  return `${toISODate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Value of <input type="datetime-local"> -> UTC date-time for the API.
export const fromDatetimeLocal = (localValue) =>
  new Date(localValue).toISOString();
