import axios from "axios";

// --------------------------------------------------
// LOGIN SESSION
//
// The login tokens live in HttpOnly cookies set by Django. JavaScript
// cannot read them (that is the point: a malicious script cannot steal
// them), and the browser attaches them to every /api request by itself.
//
// So this file never touches a token. It only keeps a harmless flag,
// "this browser is probably logged in", to decide which screen to show
// first. If the flag is wrong, the first API call answers 401 and the
// user is sent to the login page.
//   Remember Me on  -> flag in localStorage  (survives closing the browser)
//   Remember Me off -> flag in sessionStorage (cleared when the tab closes)
// --------------------------------------------------

const SESSION_FLAG = "jobtrack_logged_in";

// Per-user data cached in the browser. Cleared on logout so the next
// person to log in on this browser never sees someone else's emails.
const USER_CACHE_KEYS = ["jobtrack_gmail_preview"];

// Django's CSRF protection: for every request that changes data, axios
// copies the value of the "csrftoken" cookie into the "X-CSRFToken"
// header. Another website cannot read our cookie, so it cannot do this.
axios.defaults.xsrfCookieName = "csrftoken";
axios.defaults.xsrfHeaderName = "X-CSRFToken";

// Older versions of this app kept the tokens in browser storage.
// Remove any that are still lying around.
["accessToken", "refreshToken", "jobtrack_tracked_emails"].forEach((key) => {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
});

export const hasSession = () =>
  Boolean(
    localStorage.getItem(SESSION_FLAG) || sessionStorage.getItem(SESSION_FLAG)
  );

export const markLoggedIn = (rememberMe) => {
  const storage = rememberMe ? localStorage : sessionStorage;
  const otherStorage = rememberMe ? sessionStorage : localStorage;

  otherStorage.removeItem(SESSION_FLAG);
  storage.setItem(SESSION_FLAG, "1");
};

// Forgets the session in this browser tab (flag and cached data).
export const clearSession = () => {
  localStorage.removeItem(SESSION_FLAG);
  sessionStorage.removeItem(SESSION_FLAG);

  USER_CACHE_KEYS.forEach((key) => sessionStorage.removeItem(key));
};

// Asks the server to delete the login cookies. Only the server can:
// they are HttpOnly, so JavaScript cannot remove them itself.
export const logoutOnServer = () =>
  axios.post("/api/token/logout/").catch(() => {
    // Even if this fails the user is logged out of the interface.
  });

// --------------------------------------------------
// SESSION EXPIRY
// App registers a callback here so that this module can tell React
// "the user is no longer logged in" without importing any component.
// --------------------------------------------------

let sessionExpiredHandler = null;

export const setSessionExpiredHandler = (handler) => {
  sessionExpiredHandler = handler;
};

const expireSession = () => {
  clearSession();
  sessionExpiredHandler?.();

  return new Error("Your session has expired. Please log in again.");
};

// --------------------------------------------------
// AUTHENTICATED REQUESTS
// --------------------------------------------------

// Several requests can fail with 401 at the same moment (the dashboard
// loads three things at once). They all wait for the SAME refresh call
// instead of each starting their own.
let refreshInProgress = null;

const refreshAccessToken = () => {
  if (!refreshInProgress) {
    refreshInProgress = axios
      .post("/api/token/refresh/")
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        refreshInProgress = null;
      });
  }

  return refreshInProgress;
};

// Sends a request; the browser adds the access cookie. If the server
// answers 401 (the access token expired), the refresh cookie is exchanged
// for a new access cookie and the request is tried once more. If that
// also fails, the user is logged out.
export const apiRequest = async (method, url, data = null) => {
  const send = () => axios({ method, url, data });

  try {
    return await send();
  } catch (requestError) {
    if (requestError.response?.status !== 401) throw requestError;

    const refreshed = await refreshAccessToken();

    if (!refreshed) throw expireSession();

    try {
      return await send();
    } catch (retryError) {
      if (retryError.response?.status === 401) throw expireSession();

      throw retryError;
    }
  }
};

// Turns a DRF error body such as {"applied_date": ["This field is required."]}
// into a readable sentence.
export const getErrorMessage = (requestError, fallback) => {
  const data = requestError.response?.data;

  if (!data) return requestError.message || fallback;
  if (typeof data === "string") return fallback;
  if (data.error) return data.error;
  if (data.detail) return data.detail;

  const messages = Object.entries(data).map(([field, value]) => {
    const text = Array.isArray(value) ? value.join(" ") : String(value);

    return field === "non_field_errors" ? text : `${field}: ${text}`;
  });

  return messages.join(" ") || fallback;
};
