import { useState } from "react";
import axios from "axios";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import "./AuthPage.css";

// Login (/login) and Sign Up (/register) share this screen.
// `mode` comes from the route, so the URL decides which form is shown.
function AuthPage({ mode, onLogin }) {
  const isLogin = mode === "login";

  const navigate = useNavigate();
  const location = useLocation();

  const [firstName, setFirstName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Set by the register form when it redirects here after success.
  const registeredMessage =
    isLogin && location.state?.registered
      ? "Account created successfully. Please log in."
      : "";

  const changeMode = (loginMode) => {
    setPassword("");
    setMessage("");
    setError("");

    // Keep `from` so a deep link still works after switching tabs.
    navigate(loginMode ? "/login" : "/register", {
      state: { from: location.state?.from },
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setLoading(true);
    setMessage("");
    setError("");

    try {
      if (isLogin) {
        // Django checks the password and answers with HttpOnly cookies
        // that hold the login tokens. Nothing is stored by this code.
        await axios.post("/api/token/", {
          username,
          password,
          remember: rememberMe,
        });

        // The router then redirects to the app.
        onLogin(rememberMe);
      } else {
        await axios.post("/api/register/", {
          first_name: firstName.trim(),
          username,
          email,
          password,
        });

        setPassword("");

        navigate("/login", {
          state: { from: location.state?.from, registered: true },
        });
      }
    } catch (err) {
      const data = err.response?.data;

      if (data && typeof data === "object") {
        const firstError = Object.values(data).flat()[0];

        setError(
          typeof firstError === "string"
            ? firstError
            : "Please check your details and try again."
        );
      } else {
        setError("Unable to connect to the server. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const notice = message || registeredMessage;

  return (
    <main className="auth-page">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />

      <header className="auth-topbar">
        <Link to="/login" className="auth-brand">
          <span className="auth-brand-icon">
              <Icon name="logo" size={24} strokeWidth={2.2} />
            </span>
          <span>JobTrack</span>
        </Link>

        <span className="auth-brand-caption">Career workspace</span>
      </header>

      <div className="auth-layout">
        <section className="auth-intro">
          <p className="auth-badge">
            <Icon name="sparkle" size={13} /> Your job search, organised
          </p>

          <h1>
            Your next role
            <br />
            <span>starts here</span>
          </h1>

          <p className="auth-lead">
            Track every application, interview and follow-up in one calm
            workspace, so nothing slips through.
          </p>

          <ul className="auth-features">
            <li>
              <Icon name="document" size={14} /> Applications
            </li>
            <li>
              <Icon name="calendar" size={14} /> Interviews &amp; calendar
            </li>
            <li>
              <Icon name="mail" size={14} /> Gmail job alerts
            </li>
            <li>
              <Icon name="chart" size={14} /> Analytics
            </li>
          </ul>

          {/* Decorative floating cards that hint at what is inside the app.
              Every class here starts with "preview-" so it can never collide
              with the real dashboard, and aria-hidden keeps screen readers
              from reading sample data as if it were real. */}
          <div className="preview-stage" aria-hidden="true">
            <div className="preview-card preview-card-interview">
              <span className="preview-icon warm">
                <Icon name="users" size={16} />
              </span>

              <div>
                <small>Upcoming interview</small>
                <strong>Technical Round</strong>
                <span>Tue · 2:30 PM</span>
              </div>

              <em>In 2 days</em>
            </div>

            <div className="preview-card preview-card-stat">
              <span className="preview-icon">
                <Icon name="send" size={16} />
              </span>
              <strong>24</strong>
              <small>Applications sent</small>
            </div>

            <div className="preview-card preview-card-chart">
              <small>Applications per month</small>

              <div className="preview-bars">
                {[30, 44, 36, 58, 50, 76, 92].map((height, index) => (
                  <span key={index} style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>

            <div className="preview-card preview-card-status">
              <span className="preview-icon good">
                <Icon name="check-circle" size={16} />
              </span>

              <div>
                <strong>Offer received</strong>
                <span>Status moved to Selected</span>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-card">
          <div className="auth-mobile-brand">
            <span className="auth-brand-icon">
              <Icon name="logo" size={24} strokeWidth={2.2} />
            </span>
            <span>JobTrack</span>
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              className={isLogin ? "active" : ""}
              onClick={() => changeMode(true)}
            >
              Login
            </button>

            <button
              type="button"
              className={!isLogin ? "active" : ""}
              onClick={() => changeMode(false)}
            >
              Sign Up
            </button>
          </div>

          <div className="auth-heading">
            <h2>{isLogin ? "Welcome back" : "Create account"}</h2>

            <p>
              {isLogin
                ? "Sign in to your JobTrack account"
                : "Start your career journey with JobTrack"}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Sign up: first name and username share one row. */}
            <div className={isLogin ? undefined : "auth-row"}>
              {!isLogin && (
                <div className="auth-field">
                  <label htmlFor="first-name">First name</label>

                  <div className="auth-input">
                    <Icon name="sparkle" size={17} />
                    <input
                      id="first-name"
                      type="text"
                      placeholder="Your name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      autoComplete="given-name"
                      maxLength={150}
                    />
                  </div>
                </div>
              )}

              <div className="auth-field">
                <label htmlFor="username">Username</label>

                <div className="auth-input">
                  <Icon name="user" size={17} />
                  <input
                    id="username"
                    type="text"
                    placeholder={isLogin ? "Enter your username" : "Choose one"}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>
            </div>

            {!isLogin && (
              <div className="auth-field">
                <label htmlFor="email">Email address</label>

                <div className="auth-input">
                  <Icon name="mail" size={17} />
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="password">Password</label>

              <div className="auth-input">
                <Icon name="lock" size={17} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={
                    isLogin ? "Enter your password" : "At least 8 characters"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                />

                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <Icon name={showPassword ? "eye-off" : "eye"} size={18} />
                </button>
              </div>
            </div>

            {isLogin && (
              <div className="auth-options">
                <label className="auth-remember">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
              </div>
            )}

            {error && (
              <div className="auth-message error" role="alert">
                {error}
              </div>
            )}

            {!error && notice && (
              <div className="auth-message success" role="status">
                {notice}
              </div>
            )}

            <button className="auth-submit" disabled={loading}>
              {loading
                ? "Please wait..."
                : isLogin
                  ? "Sign In →"
                  : "Create Account →"}
            </button>
          </form>

          <p className="auth-secure">
            <Icon name="lock" size={12} /> Your password is stored as a
            secure one-way hash, never as plain text.
          </p>

          <div className="auth-bottom">
            <span>
              {isLogin ? "New to JobTrack?" : "Already have an account?"}
            </span>

            <button type="button" onClick={() => changeMode(!isLogin)}>
              {isLogin ? "Create an account" : "Login"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

export default AuthPage;
