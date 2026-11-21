// Salaries are stored as a plain number of rupees per year.
export const formatSalary = (salary) =>
  salary === null || salary === undefined || salary === ""
    ? "—"
    : `₹${Number(salary).toLocaleString("en-IN")}`;
