import { INTERVIEW_OUTCOMES, INTERVIEW_TYPES } from "../constants";
import FormField from "./FormField";
import Modal from "./Modal";

// Add / Edit interview form. Every interview belongs to one application,
// chosen in the first field.
function InterviewFormModal({
  formData,
  jobs,
  isEditing,
  saving,
  error,
  fieldErrors,
  onChange,
  onSubmit,
  onClose,
}) {
  const setField = (field) => (e) =>
    onChange({ ...formData, [field]: e.target.value });

  const control = (field) => ({
    id: `interview-${field}`,
    value: formData[field],
    onChange: setField(field),
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field]
      ? `interview-${field}-error`
      : undefined,
  });

  const selectedJob = jobs.find((job) => String(job.id) === String(formData.job));

  // Offer to move the application forward when it has not reached the
  // interview stage yet.
  const canAdvanceStatus =
    !isEditing &&
    selectedJob &&
    ["Interested", "Applied"].includes(selectedJob.status);

  const sortedJobs = [...jobs].sort((a, b) =>
    a.company_name.localeCompare(b.company_name)
  );

  return (
    <Modal
      title={isEditing ? "Edit Interview" : "Schedule Interview"}
      subtitle={
        isEditing
          ? "Update the details or record the outcome."
          : "Add an interview round for one of your applications."
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} noValidate>
        <div className="job-form-grid">
          <FormField
            id="interview-job"
            label="Application *"
            fullWidth
            error={fieldErrors.job}
          >
            <select {...control("job")}>
              <option value="">Select an application...</option>

              {sortedJobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.company_name} — {job.job_role}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="interview-round_name"
            label="Interview Round *"
            error={fieldErrors.round_name}
          >
            <input
              type="text"
              placeholder="e.g. Technical Round 1"
              maxLength={100}
              {...control("round_name")}
            />
          </FormField>

          <FormField
            id="interview-interview_type"
            label="Interview Type"
            error={fieldErrors.interview_type}
          >
            <select {...control("interview_type")}>
              {INTERVIEW_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="interview-scheduled_at"
            label="Date and Time *"
            hint="In your local time."
            error={fieldErrors.scheduled_at}
          >
            <input type="datetime-local" {...control("scheduled_at")} />
          </FormField>

          <FormField
            id="interview-outcome"
            label="Outcome"
            error={fieldErrors.outcome}
          >
            <select {...control("outcome")}>
              {INTERVIEW_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcome}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="interview-meeting_link"
            label="Meeting Link"
            error={fieldErrors.meeting_link}
          >
            <input
              type="url"
              placeholder="https://meet.google.com/..."
              maxLength={500}
              {...control("meeting_link")}
            />
          </FormField>

          <FormField
            id="interview-location"
            label="Location"
            error={fieldErrors.location}
          >
            <input
              type="text"
              placeholder="Office address, if in person"
              maxLength={200}
              {...control("location")}
            />
          </FormField>

          <FormField
            id="interview-notes"
            label="Notes"
            fullWidth
            error={fieldErrors.notes}
          >
            <textarea
              rows="3"
              placeholder="Topics to prepare, interviewer names, feedback..."
              {...control("notes")}
            />
          </FormField>
        </div>

        {canAdvanceStatus && (
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={formData.advanceStatus}
              onChange={(e) =>
                onChange({ ...formData, advanceStatus: e.target.checked })
              }
            />
            <span>
              Also change this application's status from{" "}
              <strong>{selectedJob.status}</strong> to{" "}
              <strong>Interview</strong>
            </span>
          </label>
        )}

        {error && (
          <div className="dashboard-error" role="alert">
            {error}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="cancel-button" onClick={onClose}>
            Cancel
          </button>

          <button type="submit" className="add-job-button" disabled={saving}>
            {saving
              ? "Saving..."
              : isEditing
                ? "Update Interview"
                : "Save Interview"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default InterviewFormModal;
