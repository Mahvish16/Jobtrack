import { useEffect, useState } from "react";
import { apiRequest, getErrorMessage } from "../api";

const PREVIEW_KEY = "jobtrack_gmail_preview";

const readCache = () => {
  try {
    const cached = sessionStorage.getItem(PREVIEW_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

// All Gmail state in one place: connection status, connecting, fetching,
// pagination and removing emails once they have been handled.
// The server already leaves out emails that were tracked or dismissed
// (duplicate prevention), so the browser only removes them from the list
// that is currently on screen.
export function useGmailAlerts() {
  // null = still checking, true / false = known
  const [connected, setConnected] = useState(null);

  const [emails, setEmails] = useState(() => readCache()?.emails || []);
  const [fetched, setFetched] = useState(() => readCache()?.fetched || false);
  const [nextPageToken, setNextPageToken] = useState(
    () => readCache()?.nextPageToken || null
  );

  // Emails the server left out of the last fetch because they are not
  // about one of the user's own applications (adverts, alerts, ...).
  const [skippedCount, setSkippedCount] = useState(
    () => readCache()?.skippedCount || 0
  );

  const [fetching, setFetching] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [connectError, setConnectError] = useState("");

  const clearEmails = () => {
    setEmails([]);
    setFetched(false);
    setNextPageToken(null);
    setSkippedCount(0);
    sessionStorage.removeItem(PREVIEW_KEY);
  };

  // Ask the server whether this account has Gmail connected.
  useEffect(() => {
    let isMounted = true;

    apiRequest("get", "/api/gmail/connection/")
      .then((response) => {
        if (isMounted) setConnected(Boolean(response.data.connected));
      })
      .catch(() => {
        if (isMounted) setConnected(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Cache the preview so it survives page navigation and refreshes.
  useEffect(() => {
    if (!fetched) return;

    sessionStorage.setItem(
      PREVIEW_KEY,
      JSON.stringify({ emails, fetched, nextPageToken, skippedCount })
    );
  }, [emails, fetched, nextPageToken, skippedCount]);

  const connect = async () => {
    setConnecting(true);
    setConnectError("");

    try {
      const response = await apiRequest("get", "/api/gmail/connect/");
      const authorizationUrl = response.data.authorization_url;

      if (!authorizationUrl) {
        throw new Error("Google authorization URL was not received.");
      }

      // Leave the app and go to Google's consent screen.
      window.location.href = authorizationUrl;
    } catch (requestError) {
      console.error("Gmail connection error:", requestError);
      setConnectError(
        getErrorMessage(requestError, "Unable to connect Gmail.")
      );
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setConnectError("");

    try {
      await apiRequest("delete", "/api/gmail/connection/");

      setConnected(false);
      setFetchError("");
      clearEmails();
    } catch (requestError) {
      setConnectError(
        getErrorMessage(requestError, "Unable to disconnect Gmail.")
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const fetchEmails = async (pageToken = null) => {
    setFetching(true);
    setFetchError("");

    try {
      const url = pageToken
        ? `/api/gmail/messages/?pageToken=${encodeURIComponent(pageToken)}`
        : "/api/gmail/messages/";

      const response = await apiRequest("get", url);

      const newEmails = Array.isArray(response.data.emails)
        ? response.data.emails
        : [];

      if (pageToken) {
        // "Load more": append, skipping anything already in the list.
        setEmails((previous) => {
          const existingIds = new Set(previous.map((email) => email.id));

          return [
            ...previous,
            ...newEmails.filter((email) => !existingIds.has(email.id)),
          ];
        });
      } else {
        setEmails(newEmails);
      }

      setNextPageToken(response.data.next_page_token || null);
      setSkippedCount((previous) =>
        (pageToken ? previous : 0) + (response.data.skipped_count || 0)
      );
      setFetched(true);
      setConnected(true);
    } catch (requestError) {
      console.error(
        "Gmail fetch error:",
        requestError.response?.data || requestError
      );

      // The server says the connection is missing or no longer valid.
      const code = requestError.response?.data?.code;

      if (code === "gmail_not_connected" || code === "gmail_reconnect") {
        setConnected(false);
        clearEmails();
      }

      setFetchError(
        getErrorMessage(requestError, "Unable to fetch Gmail messages.")
      );
    } finally {
      setFetching(false);
    }
  };

  // Fetch automatically, once, as soon as we know Gmail is connected and
  // nothing has been fetched in this login session. (The cached list is
  // cleared on logout, so this runs again after the next login.)
  const [autoFetched, setAutoFetched] = useState(false);

  useEffect(() => {
    if (connected !== true || fetched || autoFetched) return;

    setAutoFetched(true);
    fetchEmails();
    // fetchEmails is recreated on every render; listing it would re-run
    // this effect needlessly. The guard above makes it run only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, fetched, autoFetched]);

  // Called after an email was tracked or used for a status update.
  const removeEmail = (emailId) =>
    setEmails((previous) => previous.filter((email) => email.id !== emailId));

  // "Not a job email": remember that on the server, then hide it.
  const dismissEmail = async (emailId) => {
    try {
      await apiRequest(
        "post",
        `/api/gmail/messages/${encodeURIComponent(emailId)}/dismiss/`
      );
      removeEmail(emailId);
    } catch (requestError) {
      setFetchError(getErrorMessage(requestError, "Unable to hide this email."));
    }
  };

  return {
    connected,
    emails,
    fetched,
    fetching,
    connecting,
    disconnecting,
    fetchError,
    connectError,
    nextPageToken,
    skippedCount,
    connect,
    disconnect,
    fetchEmails,
    removeEmail,
    dismissEmail,
  };
}
