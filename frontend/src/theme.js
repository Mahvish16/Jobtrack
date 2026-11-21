// Light / dark theme.
//
// The chosen theme is written as data-theme="dark" (or "light") on the
// <html> element. index.css defines two sets of colour variables and the
// attribute decides which set is active.

const THEME_KEY = "jobtrack_theme";

// First visit: follow the computer's own light / dark setting.
// After that: whatever the user picked last.
export const getInitialTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY);

    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage can be unavailable (private mode); fall through.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
};

export const saveTheme = (theme) => {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not being able to remember the choice is harmless.
  }
};
