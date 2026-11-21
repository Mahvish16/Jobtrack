import { addDays, daysFromToday, toISODate, todayISO } from "./dates";

// Display settings for each kind of calendar event.
// `icon` is a name from components/Icon.jsx.
export const EVENT_TYPES = {
  interview: { label: "Interview", icon: "users" },
  followup: { label: "Follow-up", icon: "bell" },
  deadline: { label: "Deadline", icon: "flag" },
  application: { label: "Applied", icon: "send" },
};

// Turns applications and interviews into one flat list of dated events,
// which both the Calendar page and the Dashboard reminders read from.
export const buildEvents = (jobs, interviews) => {
  const events = [];
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  jobs.forEach((job) => {
    const base = { job, title: job.company_name, detail: job.job_role };

    if (job.applied_date) {
      events.push({
        ...base,
        key: `application-${job.id}`,
        type: "application",
        date: job.applied_date,
      });
    }

    if (job.follow_up_date) {
      events.push({
        ...base,
        key: `followup-${job.id}`,
        type: "followup",
        date: job.follow_up_date,
      });
    }

    if (job.deadline) {
      events.push({
        ...base,
        key: `deadline-${job.id}`,
        type: "deadline",
        date: job.deadline,
      });
    }
  });

  interviews.forEach((interview) => {
    events.push({
      key: `interview-${interview.id}`,
      type: "interview",
      // The day is taken in the user's time zone, not UTC.
      date: toISODate(new Date(interview.scheduled_at)),
      dateTime: interview.scheduled_at,
      title: interview.company_name,
      detail: interview.round_name,
      job: jobsById.get(interview.job) || null,
      interview,
    });
  });

  // Earliest first; within a day, timed events (interviews) by time.
  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.dateTime || "").localeCompare(b.dateTime || "")
  );
};

const OPEN_STATUSES = ["Interested", "Applied", "Interview"];

// What needs the user's attention: the next 7 days, plus follow-ups that
// are up to two weeks overdue on applications that are still open.
export const getReminders = (events) => {
  const today = todayISO();
  const horizon = toISODate(addDays(new Date(), 7));
  const overdueLimit = toISODate(addDays(new Date(), -14));

  return events
    .filter((event) => {
      if (event.type === "interview") {
        return (
          event.interview.outcome === "Scheduled" &&
          event.date >= today &&
          event.date <= horizon
        );
      }

      if (event.type === "followup") {
        return (
          OPEN_STATUSES.includes(event.job.status) &&
          event.date >= overdueLimit &&
          event.date <= horizon
        );
      }

      if (event.type === "deadline") {
        return (
          event.job.status !== "Rejected" &&
          event.date >= today &&
          event.date <= horizon
        );
      }

      return false;
    })
    .map((event) => ({ ...event, overdue: daysFromToday(event.date) < 0 }));
};
