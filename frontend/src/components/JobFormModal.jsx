import { STATUSES } from "../constants";
import { JOB_ROLES } from "../data/jobRoles";
import Combobox from "./Combobox";
import FormField from "./FormField";
import Modal from "./Modal";

// Add / Edit application form. It is a "controlled" form: the values live
// in AppLayout's state and every keystroke goes through onChange.
function JobFormModal({
  formData,
  isEditing,
  fromEmail,
  saving,
  error,
  fieldErrors,
  onChange,
  onSubmit,
  onClose,
}) {
  const setField = (field) => (e) =>
    onChange({ ...formData, [field]: e.target.value });

  // Shared props for an input: value, change handler and error wiring.
  const control = (field) => ({
    id: `job-${field}`,
    value: formData[field],
    onChange: setField(field),
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `job-${field}-error` : undefined,
  });

  return (
    <Modal
      title={isEditing ? "Edit Application" : "Add Application"}
      subtitle={
        fromEmail
          ? "Filled in from your email. Check the details before saving."
          : isEditing
            ? "Update your application details."
            : "Keep track of your new opportunity."
      }
      onClose={onClose}
    >
      {/* noValidate: our own messages are shown instead of the browser's. */}
      <form onSubmit={onSubmit} noValidate>
        <div className="job-form-grid">
          <FormField
            id="job-company_name"
            label="Company Name *"
            error={fieldErrors.company_name}
          >
            <input
              type="text"
              placeholder="e.g. Google"
              maxLength={150}
              {...control("company_name")}
            />
          </FormField>

          <FormField
            id="job-job_role"
            label="Job Role *"
            error={fieldErrors.job_role}
          >
            {/* Searchable list of common titles; any typed text is fine too. */}
            <Combobox
              {...control("job_role")}
              onChange={(value) => onChange({ ...formData, job_role: value })}
              options={JOB_ROLES}
              placeholder="Search or type a role"
              maxLength={150}
            />
          </FormField>

          <FormField
            id="job-location"
            label="Location"
            error={fieldErrors.location}
          >
            <input
              type="text"
              placeholder="e.g. Bangalore"
              maxLength={150}
              {...control("location")}
            />
          </FormField>

          <FormField
            id="job-salary"
            label="Salary (per annum)"
            error={fieldErrors.salary}
          >
            <input
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 600000"
              {...control("salary")}
            />
          </FormField>

          <FormField
            id="job-status"
            label="Application Status"
            error={fieldErrors.status}
          >
            <select {...control("status")}>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="job-applied_date"
            label="Applied Date *"
            error={fieldErrors.applied_date}
          >
            <input type="date" {...control("applied_date")} />
          </FormField>

          <FormField
            id="job-follow_up_date"
            label="Follow-up Date"
            hint="Shown as a reminder on your dashboard."
            error={fieldErrors.follow_up_date}
          >
            <input type="date" {...control("follow_up_date")} />
          </FormField>

          <FormField
            id="job-deadline"
            label="Deadline"
            hint="Last date to apply or respond."
            error={fieldErrors.deadline}
          >
            <input type="date" {...control("deadline")} />
          </FormField>

          <FormField
            id="job-job_url"
            label="Job Posting Link"
            fullWidth
            error={fieldErrors.job_url}
          >
            <input
              type="url"
              placeholder="https://..."
              maxLength={500}
              {...control("job_url")}
            />
          </FormField>

          <FormField
            id="job-description"
            label="Job Description / Notes"
            fullWidth
            error={fieldErrors.description}
          >
            <textarea
              rows="3"
              placeholder="Add any important details..."
              {...control("description")}
            />
          </FormField>
        </div>

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
                ? "Update Application"
                : "Save Application"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default JobFormModal;
