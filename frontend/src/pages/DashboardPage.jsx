import { useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import JobTable from "../components/JobTable";
import StatsGrid from "../components/StatsGrid";
import {
  formatDate,
  formatTime,
  parseISODate,
  relativeDay,
  todayISO,
} from "../utils/dates";
import { EVENT_TYPES, buildEvents, getReminders } from "../utils/events";
import { displayName } from "../utils/user";
import "./DashboardPage.css";

const RECENT_LIMIT = 5;
const REMINDER_LIMIT = 3;


// Summary page: key numbers, reminders and the latest few applications.
// Full application management lives on /applications, and the Gmail
// emails on /emails.
function DashboardPage() {
  const {
    jobs,
    interviews,
    profile,
    loading,
    gmail,
    onAdd,
    onView,
    onEdit,
    onDelete,
    onEditInterview,
  } = useOutletContext();

  const recentJobs = [...jobs]
    .sort(
      (a, b) => new Date(b.applied_date || 0) - new Date(a.applied_date || 0)
    )
    .slice(0, RECENT_LIMIT);

  const reminders = useMemo(
    () => getReminders(buildEvents(jobs, interviews)),
    [jobs, interviews]
  );

  const todayLabel = parseISODate(todayISO()).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const openReminder = (reminder) =>
    reminder.type === "interview"
      ? onEditInterview(reminder.interview)
      : onView(reminder.job);

  return (
    <>
      <div className="page-intro">
        <div>
          <h2>
            Welcome back{profile ? `, ${displayName(profile)}` : ""} 👋
          </h2>
          <p>{todayLabel} · Here's where your job search stands.</p>
        </div>

        <button type="button" className="add-job-button" onClick={onAdd}>
          + Add Application
        </button>
      </div>

      <StatsGrid loading={loading} jobs={jobs} />

      {/* GMAIL SUMMARY: the emails themselves are on the Job Emails page. */}
      {gmail.connected && gmail.emails.length > 0 && (
        <div className="dashboard-gmail-banner">
          <span className="dashboard-gmail-banner-icon">
            <Icon name="mail" size={19} />
          </span>

          <div className="dashboard-gmail-banner-text">
            <strong>
              {gmail.emails.length} job email
              {gmail.emails.length === 1 ? "" : "s"} waiting for review
            </strong>
            <span>Found in your Gmail. Track them or update a status.</span>
          </div>

          <Link to="/emails">Review emails →</Link>
        </div>
      )}

      {gmail.connected === false && (
        <div className="dashboard-gmail-banner">
          <span className="dashboard-gmail-banner-icon">
            <Icon name="mail" size={19} />
          </span>

          <div className="dashboard-gmail-banner-text">
            <strong>Find job emails automatically</strong>
            <span>
              Connect Gmail and JobTrack lists your application emails for you.
            </span>
          </div>

          <Link to="/emails">Set up Gmail →</Link>
        </div>
      )}

      {/* Two columns: the list of applications, and what needs attention. */}
      <div className="dashboard-grid">
        {/* RECENT APPLICATIONS */}
        <section className="applications-section">
          <div className="section-heading">
            <div>
              <h2>Recent Applications</h2>
              <p>Your latest job application activity</p>
            </div>

            <Link to="/applications" className="application-count">
              View all {jobs.length}
            </Link>
          </div>

          {loading ? (
            <EmptyState text="Loading your applications..." />
          ) : jobs.length === 0 ? (
            <div className="empty-state">
              <h3>No applications yet</h3>
              <p>Add your first one to start tracking your job search.</p>

              <button
                type="button"
                className="applications-clear-button"
                onClick={onAdd}
              >
                + Add Application
              </button>
            </div>
          ) : (
            <JobTable
              jobs={recentJobs}
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )}
        </section>

        <div className="dashboard-side">
          {/* REMINDERS */}
          <section className="applications-section">
            <div className="section-heading">
              <div>
                <h2>Coming Up</h2>
                <p>The next 7 days</p>
              </div>

              <Link to="/calendar" className="application-count">
                Calendar
              </Link>
            </div>

            {loading ? (
              <EmptyState text="Loading..." />
            ) : reminders.length === 0 ? (
              <div className="dashboard-side-empty">
                <span className="dashboard-side-empty-icon">
                  <Icon name="calendar" size={18} />
                </span>
                <p>
                  Nothing scheduled this week. Interviews, follow-up dates and
                  deadlines will show up here.
                </p>
              </div>
            ) : (
              <ul className="dashboard-reminders">
                {reminders.slice(0, REMINDER_LIMIT).map((reminder) => (
                  <li key={reminder.key}>
                    <button
                      type="button"
                      onClick={() => openReminder(reminder)}
                    >
                      <span className="dashboard-reminder-top">
                        <span className={`event-chip ${reminder.type}`}>
                          <Icon
                            name={EVENT_TYPES[reminder.type].icon}
                            size={12}
                          />
                          {EVENT_TYPES[reminder.type].label}
                        </span>

                        <span
                          className={`dashboard-reminder-when ${
                            reminder.overdue ? "overdue" : ""
                          }`}
                        >
                          {reminder.overdue ? "Overdue · " : ""}
                          {relativeDay(reminder.date)}
                        </span>
                      </span>

                      <span className="dashboard-reminder-text">
                        <strong>{reminder.title}</strong>
                        <span>
                          {reminder.detail} ·{" "}
                          {reminder.dateTime
                            ? `${formatDate(reminder.date)}, ${formatTime(reminder.dateTime)}`
                            : formatDate(reminder.date)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {reminders.length > REMINDER_LIMIT && (
              <p className="dashboard-side-more">
                +{reminders.length - REMINDER_LIMIT} more in the calendar
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

export default DashboardPage;
