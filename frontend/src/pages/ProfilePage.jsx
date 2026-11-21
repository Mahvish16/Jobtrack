import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { apiRequest, getErrorMessage } from "../api";
import EmptyState from "../components/EmptyState";
import FormField from "../components/FormField";
import Icon from "../components/Icon";
import { formatDate, toISODate } from "../utils/dates";
import { displayName, fullName } from "../utils/user";
import { fieldErrorsFromResponse } from "../utils/validation";
import "./ProfilePage.css";

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// ---------- Edit name and email ----------

function EditProfileForm({ profile, onSaved }) {
  const [form, setForm] = useState({
    first_name: profile.first_name || "",
    last_name: profile.last_name || "",
    email: profile.email || "",
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const setField = (field) => (e) =>
    setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const found = {};

    if (!form.email.trim()) found.email = "Email is required.";
    else if (!isValidEmail(form.email.trim())) {
      found.email = "Enter a valid email address.";
    }

    setErrors(found);
    setFormError("");

    if (Object.keys(found).length > 0) return;

    setSaving(true);

    try {
      // PATCH = change only the fields that are sent.
      const response = await apiRequest("patch", "/api/me/", {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
      });

      onSaved(response.data);
    } catch (requestError) {
      const serverErrors = fieldErrorsFromResponse(
        requestError,
        Object.keys(form)
      );

      setErrors(serverErrors);

      if (Object.keys(serverErrors).length === 0) {
        setFormError(getErrorMessage(requestError, "Unable to save profile."));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="job-form-grid">
        <FormField
          id="profile-first_name"
          label="First Name"
          error={errors.first_name}
        >
          <input
            id="profile-first_name"
            type="text"
            maxLength={150}
            autoComplete="given-name"
            value={form.first_name}
            onChange={setField("first_name")}
          />
        </FormField>

        <FormField
          id="profile-last_name"
          label="Last Name"
          error={errors.last_name}
        >
          <input
            id="profile-last_name"
            type="text"
            maxLength={150}
            autoComplete="family-name"
            value={form.last_name}
            onChange={setField("last_name")}
          />
        </FormField>

        <FormField
          id="profile-username"
          label="Username"
          hint="Your username cannot be changed."
        >
          <input
            id="profile-username"
            type="text"
            value={profile.username}
            disabled
          />
        </FormField>

        <FormField id="profile-email" label="Email *" error={errors.email}>
          <input
            id="profile-email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={setField("email")}
          />
        </FormField>
      </div>

      {formError && (
        <div className="dashboard-error profile-form-error" role="alert">
          {formError}
        </div>
      )}

      <div className="profile-actions">
        <button type="submit" className="add-job-button" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

// ---------- Change password ----------

const EMPTY_PASSWORDS = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};

function ChangePasswordForm({ onChanged }) {
  const [form, setForm] = useState(EMPTY_PASSWORDS);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const setField = (field) => (e) =>
    setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();

    const found = {};

    if (!form.current_password) {
      found.current_password = "Enter your current password.";
    }

    if (form.new_password.length < 8) {
      found.new_password = "Use at least 8 characters.";
    }

    if (form.confirm_password !== form.new_password) {
      found.confirm_password = "The two new passwords do not match.";
    }

    setErrors(found);
    setFormError("");

    if (Object.keys(found).length > 0) return;

    setSaving(true);

    try {
      await apiRequest("post", "/api/me/password/", {
        current_password: form.current_password,
        new_password: form.new_password,
      });

      setForm(EMPTY_PASSWORDS);
      onChanged();
    } catch (requestError) {
      const serverErrors = fieldErrorsFromResponse(
        requestError,
        Object.keys(form)
      );

      setErrors(serverErrors);

      if (Object.keys(serverErrors).length === 0) {
        setFormError(
          getErrorMessage(requestError, "Unable to change password.")
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const passwordField = (field, label, autoComplete) => (
    <FormField id={`profile-${field}`} label={label} error={errors[field]}>
      <input
        id={`profile-${field}`}
        type="password"
        autoComplete={autoComplete}
        value={form[field]}
        onChange={setField(field)}
      />
    </FormField>
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="job-form-grid profile-password-grid">
        {passwordField(
          "current_password",
          "Current Password",
          "current-password"
        )}
        {passwordField("new_password", "New Password", "new-password")}
        {passwordField(
          "confirm_password",
          "Confirm New Password",
          "new-password"
        )}
      </div>

      {formError && (
        <div className="dashboard-error profile-form-error" role="alert">
          {formError}
        </div>
      )}

      <div className="profile-actions">
        <button type="submit" className="add-job-button" disabled={saving}>
          {saving ? "Saving..." : "Change Password"}
        </button>
      </div>
    </form>
  );
}

// ---------- Delete account ----------

function DeleteAccount({ jobCount, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {
    e.preventDefault();

    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }

    setDeleting(true);
    setError("");

    try {
      // The server checks the password again before deleting anything.
      await apiRequest("delete", "/api/me/", { password });

      onDeleted();
    } catch (requestError) {
      setError(
        fieldErrorsFromResponse(requestError, ["password"]).password ||
          getErrorMessage(requestError, "Unable to delete account.")
      );
      setDeleting(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        className="profile-danger-button"
        onClick={() => setConfirming(true)}
      >
        <Icon name="trash" size={15} /> Delete Account
      </button>
    );
  }

  return (
    <form className="profile-delete-form" onSubmit={handleDelete} noValidate>
      <p>
        This permanently deletes your account, your {jobCount} application
        {jobCount === 1 ? "" : "s"}, all interviews and your Gmail connection.
        It cannot be undone.
      </p>

      <FormField
        id="profile-delete-password"
        label="Enter your password to confirm"
        error={error}
      >
        <input
          id="profile-delete-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </FormField>

      <div className="profile-actions">
        <button
          type="button"
          className="cancel-button"
          onClick={() => {
            setConfirming(false);
            setPassword("");
            setError("");
          }}
        >
          Cancel
        </button>

        <button
          type="submit"
          className="profile-danger-button solid"
          disabled={deleting}
        >
          {deleting ? "Deleting..." : "Permanently Delete My Account"}
        </button>
      </div>
    </form>
  );
}

// ---------- Page ----------

function ProfilePage() {
  const { profile, jobs, onProfileChange, onLogout, showNotice } =
    useOutletContext();

  if (!profile) {
    return (
      <section className="applications-section">
        <EmptyState text="Loading your profile..." />
      </section>
    );
  }


  return (
    <div className="profile-page">
      <div className="page-intro">
        <div>
          <h2>My Profile</h2>
          <p>Manage your account details and security.</p>
        </div>
      </div>

      <section className="applications-section profile-summary">
        <div className="profile-summary-avatar">
          {displayName(profile).charAt(0).toUpperCase()}
        </div>

        <div className="profile-summary-text">
          <h3>{fullName(profile)}</h3>
          <p>
            @{profile.username} · {profile.email}
          </p>
          {profile.date_joined && (
            <span>
              Member since{" "}
              {formatDate(toISODate(new Date(profile.date_joined)))} ·{" "}
              {jobs.length} application{jobs.length === 1 ? "" : "s"} tracked
            </span>
          )}
        </div>
      </section>

      <section className="applications-section">
        <div className="section-heading">
          <div>
            <h2>Edit Profile</h2>
            <p>Your first name is used to greet you across the app.</p>
          </div>
        </div>

        {/* key: reset the form if the profile is replaced */}
        <EditProfileForm
          key={profile.id}
          profile={profile}
          onSaved={(updated) => {
            onProfileChange(updated);
            showNotice("Profile updated.");
          }}
        />
      </section>

      <section className="applications-section">
        <div className="section-heading">
          <div>
            <h2>Change Password</h2>
            <p>Use at least 8 characters that are hard to guess.</p>
          </div>
        </div>

        <ChangePasswordForm onChanged={() => showNotice("Password changed.")} />
      </section>

      <section className="applications-section profile-danger">
        <div className="profile-row">
          <div>
            <h2>Delete Account</h2>
            <p>Permanently remove your account and all of its data.</p>
          </div>
        </div>

        <DeleteAccount jobCount={jobs.length} onDeleted={onLogout} />
      </section>
    </div>
  );
}

export default ProfilePage;
