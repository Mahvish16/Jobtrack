// Client-side form validation. It gives instant feedback, but it is only a
// convenience: the Django serializers validate everything again, because a
// request can always be sent without going through this form.

const MAX_SALARY = 2147483647; // largest value a PostgreSQL integer can hold

const isValidUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const isValidDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

// Each function returns an object like { company_name: "message" }.
// An empty object means the form is valid.

export const validateJob = (form) => {
  const errors = {};

  if (!form.company_name.trim()) {
    errors.company_name = "Company name is required.";
  } else if (form.company_name.length > 150) {
    errors.company_name = "Company name must be 150 characters or fewer.";
  }

  if (!form.job_role.trim()) {
    errors.job_role = "Job role is required.";
  } else if (form.job_role.length > 150) {
    errors.job_role = "Job role must be 150 characters or fewer.";
  }

  if (form.salary !== "" && form.salary !== null) {
    const salary = Number(form.salary);

    if (!Number.isInteger(salary) || salary < 0) {
      errors.salary = "Salary must be a whole number, 0 or more.";
    } else if (salary > MAX_SALARY) {
      errors.salary = "Salary is too large.";
    }
  }

  if (!form.applied_date) {
    errors.applied_date = "Applied date is required.";
  } else if (!isValidDate(form.applied_date)) {
    errors.applied_date = "Enter a valid date.";
  }

  if (form.job_url && !isValidUrl(form.job_url)) {
    errors.job_url = "Enter a full link starting with http:// or https://";
  }

  if (
    form.follow_up_date &&
    form.applied_date &&
    form.follow_up_date < form.applied_date
  ) {
    errors.follow_up_date = "Follow-up cannot be before the applied date.";
  }

  return errors;
};

export const validateInterview = (form) => {
  const errors = {};

  if (!form.job) errors.job = "Choose the application this interview is for.";

  if (!form.round_name.trim()) {
    errors.round_name = "Round name is required.";
  } else if (form.round_name.length > 100) {
    errors.round_name = "Round name must be 100 characters or fewer.";
  }

  if (!form.scheduled_at) {
    errors.scheduled_at = "Date and time are required.";
  } else if (Number.isNaN(new Date(form.scheduled_at).getTime())) {
    errors.scheduled_at = "Enter a valid date and time.";
  }

  if (form.meeting_link && !isValidUrl(form.meeting_link)) {
    errors.meeting_link = "Enter a full link starting with http:// or https://";
  }

  return errors;
};

// DRF answers a failed save with { field: ["message"] }. This keeps the
// messages for fields the form knows, so they appear next to the input.
export const fieldErrorsFromResponse = (requestError, knownFields) => {
  const data = requestError.response?.data;
  const errors = {};

  if (!data || typeof data !== "object") return errors;

  knownFields.forEach((field) => {
    if (data[field]) {
      errors[field] = Array.isArray(data[field])
        ? data[field].join(" ")
        : String(data[field]);
    }
  });

  return errors;
};
