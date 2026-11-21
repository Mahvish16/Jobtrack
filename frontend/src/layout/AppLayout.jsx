import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { apiRequest, getErrorMessage } from "../api";
import { NAV_ITEMS } from "../constants";
import { applyTheme, getInitialTheme, saveTheme } from "../theme";
import { useGmailAlerts } from "../hooks/useGmailAlerts";
import {
  fromDatetimeLocal,
  toDatetimeLocal,
  toISODate,
  todayISO,
} from "../utils/dates";
import {
  fieldErrorsFromResponse,
  validateInterview,
  validateJob,
} from "../utils/validation";
import InterviewFormModal from "../components/InterviewFormModal";
import Icon from "../components/Icon";
import UserMenu from "../components/UserMenu";
import JobDetailsModal from "../components/JobDetailsModal";
import JobFormModal from "../components/JobFormModal";
import "./AppLayout.css";

const emptyJobForm = () => ({
  company_name: "",
  job_role: "",
  location: "",
  salary: "",
  status: "Applied",
  applied_date: todayISO(),
  follow_up_date: "",
  deadline: "",
  job_url: "",
  description: "",
});

const emptyInterviewForm = (jobId = "") => ({
  job: jobId,
  round_name: "",
  interview_type: "Video",
  scheduled_at: "",
  meeting_link: "",
  location: "",
  outcome: "Scheduled",
  notes: "",
  advanceStatus: true,
});

const PROFILE_PAGE = { path: "/profile", label: "Profile" };

// localStorage can be unavailable (private mode), so never let it crash.
const SIDEBAR_KEY = "jobtrack_sidebar";

const readSidebarPreference = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY);
  } catch {
    return null;
  }
};

const saveSidebarPreference = (value) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, value);
  } catch {
    // Not being able to remember the preference is harmless.
  }
};

const JOB_FIELDS = Object.keys(emptyJobForm());
const INTERVIEW_FIELDS = Object.keys(emptyInterviewForm());

// The shell around every logged-in page: sidebar, top bar and the dialogs.
// It owns the applications and interviews, so the data is fetched once and
// shared by all pages instead of once per page.
// <Outlet /> is where React Router renders the page for the current URL.
function AppLayout({ onLogout }) {
  const location = useLocation();

  const [jobs, setJobs] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Add / Edit application dialog
  const [jobForm, setJobForm] = useState(null); // null = closed
  const [editingJob, setEditingJob] = useState(null);
  const [sourceEmailId, setSourceEmailId] = useState(null);

  // Add / Edit interview dialog
  const [interviewForm, setInterviewForm] = useState(null);
  const [editingInterview, setEditingInterview] = useState(null);

  // Shared by both dialogs (only one is open at a time).
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  // Application details dialog (stores the ID, so it always shows
  // the latest version of the job from `jobs`).
  const [viewingJobId, setViewingJobId] = useState(null);

  const gmail = useGmailAlerts();

  const currentPage =
    [...NAV_ITEMS, PROFILE_PAGE].find(
      (item) => item.path === location.pathname
    ) || NAV_ITEMS[0];

  // --------------------------------------------------
  // SIDEBAR (hamburger button)
  // Desktop: collapses to an icon-only strip, remembered in localStorage.
  // Phone: slides in as a drawer over the page.
  // --------------------------------------------------

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readSidebarPreference() === "collapsed"
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isPhone = () => window.matchMedia("(max-width: 700px)").matches;

  const toggleSidebar = () => {
    if (isPhone()) {
      setMobileNavOpen((open) => !open);
      return;
    }

    setSidebarCollapsed((collapsed) => {
      saveSidebarPreference(collapsed ? "open" : "collapsed");
      return !collapsed;
    });
  };

  const closeMobileNav = () => setMobileNavOpen(false);

  // --------------------------------------------------
  // LIGHT / DARK THEME
  // --------------------------------------------------

  const [theme, setTheme] = useState(getInitialTheme);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";

    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  };

  const viewingJob = jobs.find((job) => job.id === viewingJobId) || null;

  // Start each page at the top and name the browser tab after it.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    document.title = `${currentPage.label} · JobTrack`;
  }, [currentPage]);

  // A success message disappears on its own.
  useEffect(() => {
    if (!notice) return;

    const timer = setTimeout(() => setNotice(""), 4000);

    return () => clearTimeout(timer);
  }, [notice]);

  // --------------------------------------------------
  // LOAD DATA (three requests in parallel)
  // --------------------------------------------------

  useEffect(() => {
    let isMounted = true;

    const asList = (data) => (Array.isArray(data) ? data : data.results || []);

    const loadData = async () => {
      try {
        const [jobsResponse, interviewsResponse, meResponse] =
          await Promise.all([
            apiRequest("get", "/api/jobs/"),
            apiRequest("get", "/api/interviews/"),
            apiRequest("get", "/api/me/"),
          ]);

        if (isMounted) {
          setJobs(asList(jobsResponse.data));
          setInterviews(asList(interviewsResponse.data));
          setProfile(meResponse.data);
          setError("");
        }
      } catch (requestError) {
        if (isMounted) {
          console.error(
            "Load error:",
            requestError.response?.data || requestError
          );
          setError(
            getErrorMessage(
              requestError,
              "Unable to load your data. Please try again."
            )
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const resetFormState = () => {
    setSaving(false);
    setFormError("");
    setFieldErrors({});
  };

  // --------------------------------------------------
  // APPLICATION FORM
  // --------------------------------------------------

  const openJobForm = (job, data, emailId = null) => {
    resetFormState();
    setViewingJobId(null);
    setEditingJob(job);
    setSourceEmailId(emailId);
    setJobForm(data);
  };

  const openAddForm = () => openJobForm(null, emptyJobForm());

  // From the calendar: a new application dated on the chosen day.
  const openAddFormOnDate = (isoDate) =>
    openJobForm(null, { ...emptyJobForm(), applied_date: isoDate });

  const openEditForm = (job) =>
    openJobForm(job, {
      company_name: job.company_name || "",
      job_role: job.job_role || "",
      location: job.location || "",
      salary: job.salary ?? "",
      status: job.status || "Applied",
      applied_date: job.applied_date || "",
      follow_up_date: job.follow_up_date || "",
      deadline: job.deadline || "",
      job_url: job.job_url || "",
      description: job.description || "",
    });

  // "Track This Job": open the Add form pre-filled with what the server
  // worked out from the Gmail message. The user reviews it before saving.
  const describeEmail = (email, text) =>
    [
      "Imported from Gmail",
      `Subject: ${email.subject || "No subject"}`,
      `From: ${email.sender || "Unknown"}`,
      text ? `\n${text}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  const openFormFromEmail = async (email) => {
    // Gmail's list only gives a short preview that ends in "...".
    const preview = describeEmail(email, email.snippet);

    openJobForm(
      null,
      {
        ...emptyJobForm(),
        company_name: email.suggested_company || "",
        job_role: email.suggested_role || "",
        status: email.suggested_status || "Applied",
        applied_date: email.received_at
          ? toISODate(new Date(email.received_at))
          : todayISO(),
        description: preview,
      },
      email.id
    );

    // Then load the whole message and swap it in, unless the user has
    // already started editing the notes or closed the form.
    try {
      const response = await apiRequest(
        "get",
        `/api/gmail/messages/${encodeURIComponent(email.id)}/`
      );

      const details = response.data;
      const full = describeEmail(email, details.body);

      // Fill in what the full text revealed, but never overwrite
      // something the user has already typed.
      setJobForm((current) => {
        if (!current) return current;

        return {
          ...current,
          description:
            current.description === preview ? full : current.description,
          job_role: current.job_role || details.suggested_role || "",
          location: current.location || details.suggested_location || "",
          job_url: current.job_url || details.suggested_job_url || "",
        };
      });
    } catch (requestError) {
      // Not fatal: the short preview stays in the form.
      console.warn("Could not load the full email:", requestError.message);
    }
  };

  const closeJobForm = () => {
    setJobForm(null);
    setEditingJob(null);
    setSourceEmailId(null);
    resetFormState();
  };

  // Create = POST, update = PUT.
  const handleSaveJob = async (e) => {
    e.preventDefault();

    const errors = validateJob(jobForm);

    setFieldErrors(errors);
    setFormError("");

    if (Object.keys(errors).length > 0) return;

    setSaving(true);

    try {
      const payload = {
        ...jobForm,
        company_name: jobForm.company_name.trim(),
        job_role: jobForm.job_role.trim(),
        salary: jobForm.salary === "" ? null : Number(jobForm.salary),
        // Empty date inputs are sent as null, not "".
        follow_up_date: jobForm.follow_up_date || null,
        deadline: jobForm.deadline || null,
      };

      // Lets the server record that this email is now tracked.
      if (sourceEmailId) payload.gmail_message_id = sourceEmailId;

      const response = editingJob
        ? await apiRequest("put", `/api/jobs/${editingJob.id}/`, payload)
        : await apiRequest("post", "/api/jobs/", payload);

      const saved = response.data;

      setJobs((previous) =>
        editingJob
          ? previous.map((job) => (job.id === saved.id ? saved : job))
          : [saved, ...previous]
      );

      // Interviews carry a copy of the company and role; keep it in sync.
      if (editingJob) {
        setInterviews((previous) =>
          previous.map((interview) =>
            interview.job === saved.id
              ? {
                  ...interview,
                  company_name: saved.company_name,
                  job_role: saved.job_role,
                }
              : interview
          )
        );
      }

      if (sourceEmailId) gmail.removeEmail(sourceEmailId);

      setNotice(editingJob ? "Application updated." : "Application added.");
      closeJobForm();
    } catch (requestError) {
      console.error(
        "Save application error:",
        requestError.response?.data || requestError
      );

      const serverFieldErrors = fieldErrorsFromResponse(
        requestError,
        JOB_FIELDS
      );

      setFieldErrors(serverFieldErrors);

      if (Object.keys(serverFieldErrors).length === 0) {
        setFormError(
          getErrorMessage(
            requestError,
            "Unable to save application. Please try again."
          )
        );
      }

      setSaving(false);
    }
  };

  const handleDeleteJob = async (jobId) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this application? Its interviews will be deleted too."
    );

    if (!confirmed) return;

    try {
      await apiRequest("delete", `/api/jobs/${jobId}/`);

      setJobs((previous) => previous.filter((job) => job.id !== jobId));
      // The database deletes the job's interviews (ON DELETE CASCADE).
      setInterviews((previous) =>
        previous.filter((interview) => interview.job !== jobId)
      );
      setViewingJobId(null);
      setError("");
      setNotice("Application deleted.");
    } catch (requestError) {
      console.error("Delete error:", requestError);
      setError(getErrorMessage(requestError, "Unable to delete application."));
    }
  };

  // Change only the status (PATCH = partial update). Used for the Gmail
  // "update status" suggestion and when scheduling a first interview.
  const updateJobStatus = async (jobId, status, emailId = null) => {
    const payload = { status };

    if (emailId) payload.gmail_message_id = emailId;

    const response = await apiRequest("patch", `/api/jobs/${jobId}/`, payload);

    setJobs((previous) =>
      previous.map((job) => (job.id === jobId ? response.data : job))
    );

    return response.data;
  };

  const handleApplyEmailUpdate = async (email) => {
    try {
      const job = await updateJobStatus(
        email.matching_job.id,
        email.suggested_update,
        email.id
      );

      gmail.removeEmail(email.id);
      setNotice(`${job.company_name} is now marked as ${job.status}.`);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to update the status."));
    }
  };

  // --------------------------------------------------
  // INTERVIEW FORM
  // --------------------------------------------------

  const openAddInterview = (job = null) => {
    resetFormState();
    setViewingJobId(null);
    setEditingInterview(null);
    setInterviewForm(emptyInterviewForm(job ? String(job.id) : ""));
  };

  // From the calendar: a new interview on the chosen day, at 10:00 as a
  // starting point the user can change.
  const openAddInterviewOnDate = (isoDate) => {
    resetFormState();
    setViewingJobId(null);
    setEditingInterview(null);
    setInterviewForm({
      ...emptyInterviewForm(),
      scheduled_at: `${isoDate}T10:00`,
    });
  };

  const openEditInterview = (interview) => {
    resetFormState();
    setViewingJobId(null);
    setEditingInterview(interview);
    setInterviewForm({
      job: String(interview.job),
      round_name: interview.round_name || "",
      interview_type: interview.interview_type || "Video",
      scheduled_at: toDatetimeLocal(interview.scheduled_at),
      meeting_link: interview.meeting_link || "",
      location: interview.location || "",
      outcome: interview.outcome || "Scheduled",
      notes: interview.notes || "",
      advanceStatus: false,
    });
  };

  const closeInterviewForm = () => {
    setInterviewForm(null);
    setEditingInterview(null);
    resetFormState();
  };

  const handleSaveInterview = async (e) => {
    e.preventDefault();

    const errors = validateInterview(interviewForm);

    setFieldErrors(errors);
    setFormError("");

    if (Object.keys(errors).length > 0) return;

    setSaving(true);

    try {
      const { advanceStatus, ...fields } = interviewForm;

      const payload = {
        ...fields,
        job: Number(fields.job),
        round_name: fields.round_name.trim(),
        // The input is local time; the API stores UTC.
        scheduled_at: fromDatetimeLocal(fields.scheduled_at),
      };

      const response = editingInterview
        ? await apiRequest(
            "put",
            `/api/interviews/${editingInterview.id}/`,
            payload
          )
        : await apiRequest("post", "/api/interviews/", payload);

      const saved = response.data;

      setInterviews((previous) =>
        (editingInterview
          ? previous.map((item) => (item.id === saved.id ? saved : item))
          : [...previous, saved]
        ).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
      );

      // Optionally move the application to the "Interview" stage.
      const job = jobs.find((item) => item.id === saved.job);

      if (
        !editingInterview &&
        advanceStatus &&
        job &&
        ["Interested", "Applied"].includes(job.status)
      ) {
        await updateJobStatus(job.id, "Interview");
      }

      setNotice(editingInterview ? "Interview updated." : "Interview scheduled.");
      closeInterviewForm();
    } catch (requestError) {
      console.error(
        "Save interview error:",
        requestError.response?.data || requestError
      );

      const serverFieldErrors = fieldErrorsFromResponse(
        requestError,
        INTERVIEW_FIELDS
      );

      setFieldErrors(serverFieldErrors);

      if (Object.keys(serverFieldErrors).length === 0) {
        setFormError(
          getErrorMessage(
            requestError,
            "Unable to save interview. Please try again."
          )
        );
      }

      setSaving(false);
    }
  };

  const handleDeleteInterview = async (interviewId) => {
    if (!window.confirm("Are you sure you want to delete this interview?")) {
      return;
    }

    try {
      await apiRequest("delete", `/api/interviews/${interviewId}/`);

      setInterviews((previous) =>
        previous.filter((interview) => interview.id !== interviewId)
      );
      setError("");
      setNotice("Interview deleted.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Unable to delete interview."));
    }
  };

  // Everything a page needs, handed down through <Outlet context>.
  const outletContext = {
    jobs,
    interviews,
    profile,
    loading,
    gmail,
    onProfileChange: setProfile,
    onLogout,
    showNotice: setNotice,
    onAdd: openAddForm,
    onView: (job) => setViewingJobId(job.id),
    onEdit: openEditForm,
    onDelete: handleDeleteJob,
    onTrackEmail: openFormFromEmail,
    onApplyEmailUpdate: handleApplyEmailUpdate,
    onAddOnDate: openAddFormOnDate,
    onAddInterview: openAddInterview,
    onAddInterviewOnDate: openAddInterviewOnDate,
    onEditInterview: openEditInterview,
    onDeleteInterview: handleDeleteInterview,
  };

  return (
    <div
      className={[
        "dashboard-page",
        sidebarCollapsed ? "sidebar-collapsed" : "",
        mobileNavOpen ? "sidebar-mobile-open" : "",
      ].join(" ")}
    >
      <aside className="dashboard-sidebar" id="app-sidebar">
        <Link
          to="/dashboard"
          className="dashboard-brand"
          onClick={closeMobileNav}
        >
          <span className="dashboard-brand-icon">
            <Icon name="logo" size={21} strokeWidth={2.2} />
          </span>
          <span className="dashboard-brand-name">JobTrack</span>
        </Link>

        <p className="sidebar-label">WORKSPACE</p>

        {/* NavLink adds the "active" class when its URL is the current one. */}
        <nav className="sidebar-nav" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className="nav-link"
              title={item.label}
              onClick={closeMobileNav}
            >
              <Icon name={item.icon} size={18} />
              <span className="nav-link-label">{item.label}</span>

              {/* How many Gmail emails are waiting to be reviewed. */}
              {item.path === "/emails" && gmail.emails.length > 0 && (
                <span
                  className="nav-badge"
                  aria-label={`${gmail.emails.length} to review`}
                >
                  {gmail.emails.length > 99 ? "99+" : gmail.emails.length}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Desktop: round button on the sidebar's edge. */}
      <button
        type="button"
        className="sidebar-toggle"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-controls="app-sidebar"
        aria-expanded={!sidebarCollapsed}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={toggleSidebar}
      >
        <Icon name="chevron-left" size={15} strokeWidth={2.4} />
      </button>

      {/* Phones: tapping outside the open drawer closes it. */}
      <div className="sidebar-backdrop" onClick={closeMobileNav} />

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          {/* Phones only: opens the sidebar drawer. */}
          <button
            type="button"
            className="topbar-icon-button topbar-menu-button"
            aria-label="Open menu"
            aria-controls="app-sidebar"
            aria-expanded={mobileNavOpen}
            onClick={toggleSidebar}
          >
            <Icon name="menu" size={21} />
          </button>

          <button
            type="button"
            className="topbar-icon-button"
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            onClick={toggleTheme}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
          </button>

          <UserMenu profile={profile} onLogout={onLogout} />
        </header>

        <section className="dashboard-content">
          {error && (
            <div className="dashboard-error" role="alert">
              {error}
            </div>
          )}

          <Outlet context={outletContext} />
        </section>
      </main>

      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={15} strokeWidth={3} /> {notice}
        </div>
      )}

      {viewingJob && (
        <JobDetailsModal
          job={viewingJob}
          interviews={interviews.filter(
            (interview) => interview.job === viewingJob.id
          )}
          onClose={() => setViewingJobId(null)}
        />
      )}

      {jobForm && (
        <JobFormModal
          formData={jobForm}
          isEditing={Boolean(editingJob)}
          fromEmail={Boolean(sourceEmailId)}
          saving={saving}
          error={formError}
          fieldErrors={fieldErrors}
          onChange={setJobForm}
          onSubmit={handleSaveJob}
          onClose={closeJobForm}
        />
      )}

      {interviewForm && (
        <InterviewFormModal
          formData={interviewForm}
          jobs={jobs}
          isEditing={Boolean(editingInterview)}
          saving={saving}
          error={formError}
          fieldErrors={fieldErrors}
          onChange={setInterviewForm}
          onSubmit={handleSaveInterview}
          onClose={closeInterviewForm}
        />
      )}
    </div>
  );
}

export default AppLayout;
