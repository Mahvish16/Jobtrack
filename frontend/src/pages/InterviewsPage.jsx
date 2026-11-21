import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { INTERVIEW_TYPES } from "../constants";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import RowActions from "../components/RowActions";
import StatusBadge from "../components/StatusBadge";
import { formatTime, relativeDay, toISODate, todayISO } from "../utils/dates";
import "./InterviewsPage.css";

const typeLabel = (value) =>
  INTERVIEW_TYPES.find((type) => type.value === value)?.label || value;

function InterviewCard({ interview, needsOutcome, onEdit, onDelete, onViewJob }) {
  const date = new Date(interview.scheduled_at);

  return (
    <li className="interviews-card">
      <div className="interviews-date">
        <span>{date.toLocaleString("en", { month: "short" })}</span>
        <strong>{date.getDate()}</strong>
        <span>{date.toLocaleString("en", { weekday: "short" })}</span>
      </div>

      <div className="interviews-body">
        <div className="interviews-title">
          <h3>
            <button type="button" className="company-link" onClick={onViewJob}>
              {interview.company_name}
            </button>
          </h3>
          <StatusBadge status={interview.outcome} />
        </div>

        <p className="interviews-role">
          {interview.job_role} · <strong>{interview.round_name}</strong>
        </p>

        <ul className="interviews-meta">
          <li>
            <Icon name="clock" size={13} />
            {formatTime(interview.scheduled_at)} ·{" "}
            {relativeDay(toISODate(date))}
          </li>
          <li>
            <Icon name="video" size={13} />
            {typeLabel(interview.interview_type)}
          </li>
          {interview.location && (
            <li>
              <Icon name="pin" size={13} />
              {interview.location}
            </li>
          )}
        </ul>

        {interview.notes && (
          <p className="interviews-notes">{interview.notes}</p>
        )}

        {needsOutcome && (
          <p className="interviews-warning">
            This interview has passed. Edit it to record the outcome.
          </p>
        )}
      </div>

      <div className="interviews-actions">
        {interview.meeting_link && (
          <a
            className="interviews-join"
            href={interview.meeting_link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Join <Icon name="external" size={12} />
          </a>
        )}

        <RowActions
          label={`${interview.company_name} ${interview.round_name}`}
          onView={onViewJob}
          onEdit={onEdit}
          onDelete={onDelete}
          editLabel={needsOutcome ? "Record outcome" : "Edit"}
        />
      </div>
    </li>
  );
}

// Upcoming and past interview rounds, each linked to an application.
function InterviewsPage() {
  const {
    jobs,
    interviews,
    loading,
    onAdd,
    onView,
    onAddInterview,
    onEditInterview,
    onDeleteInterview,
  } = useOutletContext();

  const [tab, setTab] = useState("upcoming");

  // Compared by calendar day, so an interview earlier today still counts
  // as upcoming until the day is over.
  const today = todayISO();

  const isUpcoming = (interview) =>
    interview.outcome === "Scheduled" &&
    toISODate(new Date(interview.scheduled_at)) >= today;

  const upcoming = interviews.filter(isUpcoming);

  // Most recent first.
  const past = interviews.filter((item) => !isUpcoming(item)).reverse();

  const shown = tab === "upcoming" ? upcoming : past;
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  return (
    <>
      <div className="page-intro">
        <div>
          <h2>Your Interviews</h2>
          <p>Schedule interview rounds and record how they went.</p>
        </div>

        <button
          type="button"
          className="add-job-button"
          onClick={() => onAddInterview()}
          disabled={loading || jobs.length === 0}
        >
          + Schedule Interview
        </button>
      </div>

      <div className="applications-status-tabs" role="group" aria-label="Show">
        {[
          ["upcoming", "Upcoming", upcoming.length],
          ["past", "Past", past.length],
        ].map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className={`applications-status-tab ${tab === value ? "active" : ""}`}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
            <span>{loading ? "–" : count}</span>
          </button>
        ))}
      </div>

      <section className="applications-section">
        {loading ? (
          <EmptyState text="Loading interviews..." />
        ) : jobs.length === 0 ? (
          <div className="empty-state">
            <h3>Add an application first</h3>
            <p>Every interview belongs to one of your job applications.</p>

            <button
              type="button"
              className="applications-clear-button"
              onClick={onAdd}
            >
              + Add Application
            </button>
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title={
              tab === "upcoming" ? "No upcoming interviews" : "No past interviews"
            }
            text={
              tab === "upcoming"
                ? "Click “Schedule Interview” when you get an interview invitation."
                : "Completed, cancelled and past interviews will appear here."
            }
          />
        ) : (
          <ul className="interviews-list">
            {shown.map((interview) => (
              <InterviewCard
                key={interview.id}
                interview={interview}
                needsOutcome={
                  tab === "past" && interview.outcome === "Scheduled"
                }
                onEdit={() => onEditInterview(interview)}
                onDelete={() => onDeleteInterview(interview.id)}
                onViewJob={() => {
                  const job = jobsById.get(interview.job);
                  if (job) onView(job);
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default InterviewsPage;
