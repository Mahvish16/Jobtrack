import { formatDate, formatDateTime, relativeDay } from "../utils/dates";
import { formatSalary } from "../utils/format";
import Modal from "./Modal";
import StatusBadge from "./StatusBadge";

function Detail({ label, children }) {
  return (
    <div className="details-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// Read-only view of one application with everything known about it,
// including its interview rounds. Nothing can be changed from here:
// editing, deleting and scheduling are done with the table's own buttons.
function JobDetailsModal({ job, interviews, onClose }) {
  return (
    <Modal
      title={job.company_name}
      subtitle={job.job_role}
      onClose={onClose}
      wide
    >
      <dl className="details-grid">
        <Detail label="Status">
          <StatusBadge status={job.status} />
        </Detail>

        <Detail label="Applied">{formatDate(job.applied_date)}</Detail>
        <Detail label="Location">{job.location || "—"}</Detail>
        <Detail label="Salary (per annum)">{formatSalary(job.salary)}</Detail>

        <Detail label="Follow-up">
          {job.follow_up_date
            ? `${formatDate(job.follow_up_date)} · ${relativeDay(job.follow_up_date)}`
            : "—"}
        </Detail>

        <Detail label="Deadline">
          {job.deadline
            ? `${formatDate(job.deadline)} · ${relativeDay(job.deadline)}`
            : "—"}
        </Detail>

        <div className="details-item full-width">
          <dt>Job posting</dt>
          <dd>
            {job.job_url ? (
              // noopener: the opened site cannot control this tab.
              <a href={job.job_url} target="_blank" rel="noopener noreferrer">
                {job.job_url}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>

        <div className="details-item full-width">
          <dt>Description / Notes</dt>
          <dd className="details-notes">{job.description || "—"}</dd>
        </div>
      </dl>

      <div className="details-section-heading">
        <h3>Interviews ({interviews.length})</h3>
      </div>

      {interviews.length === 0 ? (
        <p className="details-empty">No interviews recorded yet.</p>
      ) : (
        <ul className="details-interviews">
          {interviews.map((interview) => (
            <li key={interview.id}>
              <div>
                <strong>{interview.round_name}</strong>
                <span>{formatDateTime(interview.scheduled_at)}</span>
              </div>

              <StatusBadge status={interview.outcome} />
            </li>
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button type="button" className="cancel-button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

export default JobDetailsModal;
