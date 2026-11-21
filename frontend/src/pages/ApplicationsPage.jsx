import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { STATUSES } from "../constants";
import EmptyState from "../components/EmptyState";
import JobTable from "../components/JobTable";
import Pagination from "../components/Pagination";
import "./ApplicationsPage.css";

const PAGE_SIZE = 10;

const SORT_OPTIONS = {
  newest: "Newest first",
  oldest: "Oldest first",
  company: "Company A–Z",
};

// Full management page: every application, with search, a status filter,
// sorting and pagination. All of it happens in the browser on the list that
// is already loaded. (The API supports the same options through
// ?search= ?status= ?ordering= ?page_size= for very large lists.)
function ApplicationsPage() {
  const { jobs, loading, onAdd, onView, onEdit, onDelete } =
    useOutletContext();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);

  // Changing a filter goes back to the first page.
  const changeSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const changeStatus = (value) => {
    setStatusFilter(value);
    setPage(1);
  };

  const changeSort = (value) => {
    setSortBy(value);
    setPage(1);
  };

  const countByStatus = (status) =>
    status === "All"
      ? jobs.length
      : jobs.filter((job) => job.status === status).length;

  // useMemo: only re-filter and re-sort when one of the inputs changes.
  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = jobs.filter((job) => {
      const matchesSearch =
        !query ||
        [job.company_name, job.job_role, job.location].some((value) =>
          (value || "").toLowerCase().includes(query)
        );

      const matchesStatus =
        statusFilter === "All" || job.status === statusFilter;

      return matchesSearch && matchesStatus;
    });

    const byDate = (a, b) =>
      new Date(a.applied_date || 0) - new Date(b.applied_date || 0);

    return filtered.sort((a, b) => {
      if (sortBy === "oldest") return byDate(a, b);
      if (sortBy === "company") {
        return (a.company_name || "").localeCompare(b.company_name || "");
      }
      return byDate(b, a);
    });
  }, [jobs, search, statusFilter, sortBy]);

  const hasFilters = search.trim() !== "" || statusFilter !== "All";

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("All");
    setPage(1);
  };

  // If rows were deleted, the current page may no longer exist.
  const pageCount = Math.max(1, Math.ceil(visibleJobs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const firstIndex = (currentPage - 1) * PAGE_SIZE;
  const pageJobs = visibleJobs.slice(firstIndex, firstIndex + PAGE_SIZE);

  return (
    <>
      <div className="page-intro">
        <div>
          <h2>All Applications</h2>
          <p>
            {loading
              ? "Loading your applications..."
              : `You have ${jobs.length} job ${
                  jobs.length === 1 ? "application" : "applications"
                } in your tracker.`}
          </p>
        </div>

        <button type="button" className="add-job-button" onClick={onAdd}>
          + Add Application
        </button>
      </div>

      {/* Status filter with a live count per status */}
      <div
        className="applications-status-tabs"
        role="group"
        aria-label="Filter by status"
      >
        {["All", ...STATUSES].map((status) => (
          <button
            key={status}
            type="button"
            className={`applications-status-tab ${
              statusFilter === status ? "active" : ""
            }`}
            aria-pressed={statusFilter === status}
            onClick={() => changeStatus(status)}
          >
            {status}
            <span>{loading ? "–" : countByStatus(status)}</span>
          </button>
        ))}
      </div>

      <section className="applications-section">
        <div className="applications-toolbar">
          <input
            type="search"
            className="applications-search"
            placeholder="Search company, role or location..."
            aria-label="Search applications"
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
          />

          <label className="applications-sort">
            <span>Sort by</span>

            <select
              value={sortBy}
              onChange={(e) => changeSort(e.target.value)}
            >
              {Object.entries(SORT_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <EmptyState text="Loading applications..." />
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No applications yet"
            text="Click “Add Application” to start tracking your job search."
          />
        ) : visibleJobs.length === 0 ? (
          <div className="empty-state">
            <h3>No applications found</h3>
            <p>Try changing your search or status filter.</p>

            <button
              type="button"
              className="applications-clear-button"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <JobTable
            jobs={pageJobs}
            showLocation
            showSalary
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}

        {!loading && jobs.length > 0 && (
          <p className="applications-result-count">
            {visibleJobs.length === 0
              ? `Showing 0 of ${jobs.length} applications`
              : `Showing ${firstIndex + 1}–${firstIndex + pageJobs.length} of ${
                  visibleJobs.length
                }${
                  visibleJobs.length === jobs.length
                    ? ""
                    : ` (filtered from ${jobs.length})`
                } applications`}
            {hasFilters && visibleJobs.length > 0 && (
              <>
                {" · "}
                <button
                  type="button"
                  className="applications-clear-link"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              </>
            )}
          </p>
        )}

        <Pagination
          page={currentPage}
          pageCount={pageCount}
          onChange={setPage}
        />
      </section>
    </>
  );
}

export default ApplicationsPage;
