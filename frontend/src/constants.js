// These lists must match the choices in jobs/models.py.

export const STATUSES = [
  "Interested",
  "Applied",
  "Interview",
  "Selected",
  "Rejected",
];

export const INTERVIEW_TYPES = [
  { value: "Phone", label: "Phone" },
  { value: "Video", label: "Video" },
  { value: "Onsite", label: "On-site" },
  { value: "Assessment", label: "Assessment" },
];

export const INTERVIEW_OUTCOMES = [
  "Scheduled",
  "Completed",
  "Passed",
  "Failed",
  "Cancelled",
];

// Sidebar links. `path` is the URL, so the sidebar and the router
// are driven by the same list. `icon` is a name from components/Icon.jsx.
export const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { path: "/applications", label: "Applications", icon: "document" },
  { path: "/emails", label: "Job Emails", icon: "mail" },
  { path: "/interviews", label: "Interviews", icon: "users" },
  { path: "/calendar", label: "Calendar", icon: "calendar" },
  { path: "/analytics", label: "Analytics", icon: "chart" },
];
