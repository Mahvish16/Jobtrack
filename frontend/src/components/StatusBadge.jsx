// The CSS class is the status in lowercase, e.g. "Interview" -> "interview".
function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status?.toLowerCase() || "unknown"}`}>
      {status}
    </span>
  );
}

export default StatusBadge;
