// A label, one form control (passed as children) and its error message.
// aria-describedby / role="alert" let screen readers announce the error.
function FormField({ id, label, error, fullWidth = false, hint, children }) {
  return (
    <div
      className={`job-form-field ${fullWidth ? "full-width" : ""} ${
        error ? "has-error" : ""
      }`}
    >
      <label htmlFor={id}>{label}</label>

      {children}

      {hint && !error && <p className="field-hint">{hint}</p>}

      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default FormField;
