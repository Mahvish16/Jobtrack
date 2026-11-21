import { useCallback, useEffect, useState } from "react";
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  clearSession,
  hasSession,
  logoutOnServer,
  markLoggedIn,
  setSessionExpiredHandler,
} from "./api";
import AuthPage from "./pages/AuthPage";
import AppLayout from "./layout/AppLayout";
import DashboardPage from "./pages/DashboardPage";
import ApplicationsPage from "./pages/ApplicationsPage";
import InterviewsPage from "./pages/InterviewsPage";
import CalendarPage from "./pages/CalendarPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import ProfilePage from "./pages/ProfilePage";
import EmailsPage from "./pages/EmailsPage";

// Wraps every page that needs a logged-in user. Visitors without a session
// are sent to /login, and we remember where they wanted to go.
function ProtectedRoute({ isAuthenticated }) {
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

// Wraps /login and /register. A logged-in user has no reason to see them,
// so they are sent to the page they originally asked for (or the dashboard).
function PublicOnlyRoute({ isAuthenticated }) {
  const location = useLocation();

  if (isAuthenticated) {
    return <Navigate to={location.state?.from || "/dashboard"} replace />;
  }

  return <Outlet />;
}

function App() {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState(hasSession);

  // Called after Django accepted the password and set the login cookies.
  const handleLogin = (rememberMe) => {
    markLoggedIn(rememberMe);
    setIsAuthenticated(true);
  };

  // Used when the server no longer accepts the login cookies.
  const endSession = useCallback(() => {
    clearSession();
    setIsAuthenticated(false);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(endSession);

    return () => setSessionExpiredHandler(null);
  }, [endSession]);

  // Used by the Logout button.
  const handleLogout = () => {
    logoutOnServer();
    navigate("/login", { replace: true });
    endSession();
  };

  return (
    <Routes>
      <Route element={<PublicOnlyRoute isAuthenticated={isAuthenticated} />}>
        <Route
          path="/login"
          element={<AuthPage mode="login" onLogin={handleLogin} />}
        />
        <Route
          path="/register"
          element={<AuthPage mode="register" onLogin={handleLogin} />}
        />
      </Route>

      <Route element={<ProtectedRoute isAuthenticated={isAuthenticated} />}>
        <Route element={<AppLayout onLogout={handleLogout} />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/interviews" element={<InterviewsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/emails" element={<EmailsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      {/* "/" and unknown URLs */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
