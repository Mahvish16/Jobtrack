import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { displayName, fullName } from "../utils/user";
import Icon from "./Icon";

// The name + avatar button in the top bar and the menu it opens.
function UserMenu({ profile, onLogout }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  // While the menu is open, a click anywhere else or the Escape key
  // closes it.
  useEffect(() => {
    if (!open) return;

    const handleClick = (e) => {
      if (!menuRef.current?.contains(e.target)) setOpen(false);
    };

    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const name = displayName(profile);

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="topbar-username">{name}</span>
        <span className="profile-avatar">{name.charAt(0).toUpperCase()}</span>
        <Icon name="chevron-down" size={15} />
      </button>

      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-header">
            <strong>{fullName(profile)}</strong>
            <span>{profile?.email}</span>
          </div>

          <Link
            to="/profile"
            className="user-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Icon name="user" size={16} /> My profile
          </Link>

          <button
            type="button"
            className="user-menu-item danger"
            role="menuitem"
            onClick={onLogout}
          >
            <Icon name="logout" size={16} /> Logout
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
