import { useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import { formatDateTime } from "../utils/dates";
import "./EmailsPage.css";

// What Django's Gmail callback can report back in ?gmail=...
const GMAIL_RESULTS = {
  connected: {
    type: "success",
    text: "Gmail connected. Your job emails are being fetched.",
  },
  denied: {
    type: "error",
    text: "Gmail was not connected because access was not granted.",
  },
  error: {
    type: "error",
    text: "Gmail connection failed or expired. Please try connecting again.",
  },
};

const CATEGORY_LABELS = {
  confirmation: "Application confirmation",
  interview: "Interview",
  rejection: "Rejection",
  offer: "Offer",
  other: "Job related",
};

// Job-related emails found in the user's Gmail. Each one can become a new
// application, update the status of an existing one, or be hidden.
function EmailsPage() {
  const { gmail, onTrackEmail, onApplyEmailUpdate } = useOutletContext();

  // Django sends the browser back to /emails?gmail=connected after the
  // Google consent screen. Show the result once, then clean the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const [gmailResult] = useState(
    () => GMAIL_RESULTS[searchParams.get("gmail")] || null
  );

  useEffect(() => {
    if (searchParams.has("gmail")) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const disconnect = () => {
    if (
      window.confirm(
        "Disconnect Gmail? JobTrack's access will be revoked. Your applications are kept."
      )
    ) {
      gmail.disconnect();
    }
  };

  return (
    <>
      <div className="page-intro">
        <div>
          <h2>Job Emails</h2>
          <p>
            Replies to your own job applications from the last 90 days:
            confirmations, interview invitations, rejections and offers.
            JobTrack has read-only access.
          </p>

          {gmail.connected && (
            <p className="gmail-total-count">
              <Icon name="check-circle" size={14} /> Gmail connected
              {gmail.fetched &&
                ` · ${gmail.emails.length} email${
                  gmail.emails.length === 1 ? "" : "s"
                } to review`}
            </p>
          )}
        </div>

        <div className="emails-actions">
          {gmail.connected && (
            <>
              <button
                type="button"
                className="gmail-disconnect-button"
                onClick={disconnect}
                disabled={gmail.disconnecting}
              >
                {gmail.disconnecting ? "Disconnecting..." : "Disconnect"}
              </button>

              <button
                type="button"
                className="fetch-gmail-button"
                onClick={() => gmail.fetchEmails()}
                disabled={gmail.fetching}
              >
                <Icon name="refresh" size={16} />
                {gmail.fetching ? "Fetching..." : "Fetch Emails"}
              </button>
            </>
          )}

          {gmail.connected === false && (
            <button
              type="button"
              className="fetch-gmail-button connect-gmail-button"
              onClick={gmail.connect}
              disabled={gmail.connecting}
            >
              <Icon name="mail" size={16} />
              {gmail.connecting ? "Connecting..." : "Connect Gmail"}
            </button>
          )}
        </div>
      </div>

      {gmail.connectError && (
        <div className="dashboard-error" role="alert">
          {gmail.connectError}
        </div>
      )}

      {gmailResult && (
        <div
          className={
            gmailResult.type === "success"
              ? "dashboard-success"
              : "dashboard-error"
          }
          role="status"
        >
          {gmailResult.text}
        </div>
      )}

      <section className="gmail-preview-section">
        {gmail.fetchError && (
          <div className="dashboard-error" role="alert">
            {gmail.fetchError}
          </div>
        )}

        {gmail.connected === false ? (
          <EmptyState text="Connect your Gmail account to find job application emails." />
        ) : gmail.fetching && gmail.emails.length === 0 ? (
          <EmptyState text="Fetching emails from Gmail..." />
        ) : gmail.emails.length > 0 ? (
          <div className="gmail-email-list">
            {gmail.emails.map((email) => (
              <div className="gmail-email-card" key={email.id}>
                <div className="gmail-email-icon">
                  <Icon name="mail" size={20} />
                </div>

                <div className="gmail-email-content">
                  <div className="gmail-email-top">
                    <span className={`gmail-category ${email.category}`}>
                      {CATEGORY_LABELS[email.category] || "Job related"}
                    </span>

                    <span className="gmail-email-date">
                      {email.received_at
                        ? formatDateTime(email.received_at)
                        : email.date}
                    </span>
                  </div>

                  <h3>{email.subject || "No subject"}</h3>
                  <p className="gmail-email-sender">{email.sender}</p>
                  <p className="gmail-email-snippet">{email.snippet}</p>

                  {(email.suggested_company || email.suggested_role) && (
                    <p className="gmail-email-detected">
                      Detected:{" "}
                      <strong>
                        {[email.suggested_role, email.suggested_company]
                          .filter(Boolean)
                          .join(" at ")}
                      </strong>
                    </p>
                  )}

                  {email.matching_job && (
                    <p className="gmail-email-match">
                      You already track{" "}
                      <strong>
                        {email.matching_job.company_name} —{" "}
                        {email.matching_job.job_role}
                      </strong>{" "}
                      ({email.matching_job.status}).
                    </p>
                  )}

                  <div className="gmail-email-actions">
                    {email.matching_job && email.suggested_update && (
                      <button
                        type="button"
                        className="track-job-button primary"
                        onClick={() => onApplyEmailUpdate(email)}
                      >
                        Update status to {email.suggested_update}
                      </button>
                    )}

                    <button
                      type="button"
                      className="track-job-button"
                      onClick={() => onTrackEmail(email)}
                    >
                      + Track{email.matching_job ? " as new job" : " This Job"}
                    </button>

                    <button
                      type="button"
                      className="gmail-dismiss-button"
                      onClick={() => gmail.dismissEmail(email.id)}
                    >
                      Not a job email
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : gmail.connected ? (
          <EmptyState
            text={
              gmail.fetched
                ? "No application emails to review right now."
                : "Click Fetch Emails to find recent job application emails."
            }
          />
        ) : (
          <EmptyState text="Checking Gmail connection..." />
        )}

        {gmail.connected && gmail.skippedCount > 0 && (
          <p className="gmail-skipped-note">
            {gmail.skippedCount} other email
            {gmail.skippedCount === 1 ? " was" : "s were"} left out because
            {gmail.skippedCount === 1 ? " it does" : " they do"} not look like
            a reply to an application (job adverts, alerts, newsletters and
            account notices).
          </p>
        )}

        {/* Shown even when every loaded email is handled, so older
            emails can still be reached. */}
        {gmail.connected && gmail.nextPageToken && (
          <div className="gmail-load-more-wrapper">
            <button
              type="button"
              className="fetch-gmail-button"
              onClick={() => gmail.fetchEmails(gmail.nextPageToken)}
              disabled={gmail.fetching}
            >
              {gmail.fetching ? "Loading..." : "Load More Emails"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

export default EmailsPage;
