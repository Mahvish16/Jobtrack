import { formatDate } from "../utils/dates";
import { formatSalary } from "../utils/format";
import RowActions from "./RowActions";
import StatusBadge from "./StatusBadge";

// One table used by every page. The optional columns let the Applications
// page show more detail than the short Dashboard summary.
function JobTable({
  jobs,
  onView,
  onEdit,
  onDelete,
  showLocation = false,
  showSalary = false,
}) {
  return (
    <div className="table-wrapper">
      <table className="applications-table">
        <thead>
          <tr>
            <th>Company</th>
            <th>Job Role</th>
            {showLocation && <th>Location</th>}
            {showSalary && <th>Salary</th>}
            <th>Applied Date</th>
            <th>Status</th>
            <th className="actions-column">Actions</th>
          </tr>
        </thead>

        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>
                <div className="company-cell">
                  <span className="company-avatar">
                    {job.company_name?.charAt(0)?.toUpperCase() || "C"}
                  </span>

                  <button
                    type="button"
                    className="company-link"
                    onClick={() => onView(job)}
                    title="View details"
                  >
                    {job.company_name}
                  </button>
                </div>
              </td>

              {/* A very long title is shortened with "..."; the full text
                  shows when the mouse rests on it. */}
              <td className="role-cell" title={job.job_role}>
                {job.job_role}
              </td>

              {showLocation && <td>{job.location || "—"}</td>}
              {showSalary && <td>{formatSalary(job.salary)}</td>}

              <td>{formatDate(job.applied_date)}</td>

              <td>
                <StatusBadge status={job.status} />
              </td>

              <td className="actions-column">
                <RowActions
                  label={job.company_name}
                  onView={() => onView(job)}
                  onEdit={() => onEdit(job)}
                  onDelete={() => onDelete(job.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default JobTable;
