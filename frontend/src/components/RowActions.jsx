import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

const MENU_WIDTH = 168;
const MENU_HEIGHT = 136;

// The three-dot button at the end of a row and the menu it opens
// (View, Edit, Delete).
// `onView` is optional (a row may have nothing more to show), and
// `editLabel` lets a page rename the Edit action.
function RowActions({ label, onView, onEdit, onDelete, editLabel = "Edit" }) {
  // null = closed; otherwise where on the screen the menu is drawn.
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const open = position !== null;

  const toggle = () => {
    if (open) {
      setPosition(null);
      return;
    }

    // The table scrolls sideways, which would cut off a menu placed inside
    // it. So the menu is positioned against the screen instead
    // (position: fixed), right under the button that opened it.
    const rect = buttonRef.current.getBoundingClientRect();
    const fitsBelow = rect.bottom + MENU_HEIGHT + 8 < window.innerHeight;

    setPosition({
      top: fitsBelow ? rect.bottom + 6 : rect.top - MENU_HEIGHT - 6,
      left: Math.max(8, rect.right - MENU_WIDTH),
    });
  };

  // While open: a click elsewhere, the Escape key, scrolling or resizing
  // the window closes the menu.
  useEffect(() => {
    if (!open) return;

    const close = () => setPosition(null);

    const handleClick = (e) => {
      if (
        !menuRef.current?.contains(e.target) &&
        !buttonRef.current?.contains(e.target)
      ) {
        close();
      }
    };

    const handleKey = (e) => {
      if (e.key === "Escape") {
        close();
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Close the menu, then do what was chosen.
  const choose = (action) => () => {
    setPosition(null);
    action();
  };

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="row-menu-button"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions"
        onClick={toggle}
      >
        <Icon name="more" size={18} />
      </button>

      {open && (
        <div
          ref={menuRef}
          className="row-menu"
          role="menu"
          style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
        >
          {onView && (
            <button
              type="button"
              role="menuitem"
              className="row-menu-item"
              data-action="view"
              onClick={choose(onView)}
            >
              <Icon name="eye" size={16} /> View
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className="row-menu-item"
            data-action="edit"
            onClick={choose(onEdit)}
          >
            <Icon name="pencil" size={15} /> {editLabel}
          </button>

          <button
            type="button"
            role="menuitem"
            className="row-menu-item danger"
            data-action="delete"
            onClick={choose(onDelete)}
          >
            <Icon name="trash" size={15} /> Delete
          </button>
        </div>
      )}
    </>
  );
}

export default RowActions;
