// What to call the user: their first name, or the username if they
// have not entered a name.
export const displayName = (profile) =>
  profile?.first_name?.trim() || profile?.username || "";

// First and last name together, or the username if no name was entered.
export const fullName = (profile) =>
  [profile?.first_name, profile?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") ||
  profile?.username ||
  "";
