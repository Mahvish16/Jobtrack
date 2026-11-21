import { useMemo, useRef, useState } from "react";
import Icon from "./Icon";

const MAX_SHOWN = 60;

// Options that match what was typed. Titles that START with the text come
// first ("py" -> "Python Developer" before "Senior Python Developer").
const filterOptions = (options, text) => {
  const query = text.trim().toLowerCase();

  if (!query) return options;

  const startsWith = [];
  const contains = [];

  options.forEach((option) => {
    const lower = option.toLowerCase();

    if (lower.startsWith(query)) startsWith.push(option);
    else if (lower.includes(query)) contains.push(option);
  });

  return [...startsWith, ...contains];
};

// A text field with a searchable list of suggestions.
// Type to filter, pick with the mouse or the arrow keys + Enter.
// Anything typed is also accepted, even if it is not in the list.
function Combobox({ id, value, onChange, options, placeholder, ...inputProps }) {
  const [open, setOpen] = useState(false);
  // Which option the arrow keys are on (-1 = none).
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const matches = useMemo(
    () => filterOptions(options, value),
    [options, value]
  );
  const shown = matches.slice(0, MAX_SHOWN);

  const listId = `${id}-list`;
  const optionId = (index) => `${id}-option-${index}`;

  const openList = () => {
    setOpen(true);
    setActiveIndex(-1);
  };

  const choose = (option) => {
    onChange(option);
    setOpen(false);
    setActiveIndex(-1);
  };

  const moveTo = (index) => {
    setActiveIndex(index);
    // Keep the highlighted option visible while moving with the keyboard.
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();

      if (!open) openList();
      else if (shown.length) moveTo((activeIndex + 1) % shown.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();

      if (open && shown.length) {
        moveTo(activeIndex <= 0 ? shown.length - 1 : activeIndex - 1);
      }
    } else if (e.key === "Enter" && open && activeIndex >= 0) {
      // Enter picks the highlighted option instead of submitting the form.
      e.preventDefault();
      choose(shown[activeIndex]);
    } else if (e.key === "Escape" && open) {
      // Close only the list, not the dialog around it.
      e.stopPropagation();
      setOpen(false);
    }
  };

  const typed = value.trim();
  const isExactMatch = options.some(
    (option) => option.toLowerCase() === typed.toLowerCase()
  );

  return (
    <div className="combobox">
      <input
        {...inputProps}
        id={id}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          openList();
        }}
        onFocus={openList}
        onClick={openList}
        // Leaving the field closes the list.
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
      />

      <button
        type="button"
        className="combobox-toggle"
        tabIndex={-1}
        aria-label="Show suggestions"
        // preventDefault keeps the keyboard focus in the text field.
        onMouseDown={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          setOpen(!open);
        }}
      >
        <Icon name="chevron-down" size={15} />
      </button>

      {open && (
        <ul className="combobox-list" id={listId} role="listbox" ref={listRef}>
          {shown.map((option, index) => (
            <li
              key={option}
              id={optionId(index)}
              data-index={index}
              role="option"
              aria-selected={index === activeIndex}
              className={`combobox-option ${
                index === activeIndex ? "active" : ""
              }`}
              // mousedown (not click) so it runs before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(option);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {option}
            </li>
          ))}

          {matches.length > MAX_SHOWN && (
            <li className="combobox-note" role="presentation">
              {matches.length - MAX_SHOWN} more. Keep typing to narrow the
              list.
            </li>
          )}

          {typed && !isExactMatch && (
            <li className="combobox-note" role="presentation">
              {matches.length === 0 ? "No match in the list. " : ""}
              “{typed}” will be saved as you typed it.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default Combobox;
