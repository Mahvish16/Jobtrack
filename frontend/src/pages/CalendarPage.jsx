import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import {
  addDays,
  formatDate,
  formatTime,
  parseISODate,
  relativeDay,
  toISODate,
  todayISO,
} from "../utils/dates";
import { EVENT_TYPES, buildEvents } from "../utils/events";
import "./CalendarPage.css";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UPCOMING_LIMIT = 5;

// True while the browser window is short (a laptop, or a zoomed-in page).
// The month view then shows one event per day instead of two, so every
// week still fits on the screen.
function useShortWindow() {
  const query = "(max-height: 820px)";
  const [isShort, setIsShort] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setIsShort(media.matches);

    media.addEventListener("change", update);

    return () => media.removeEventListener("change", update);
  }, []);

  return isShort;
}

// Monday of the week that contains `date`.
const startOfWeek = (date) => {
  const day = (date.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  return addDays(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    -day
  );
};

// The days shown for a month: whole weeks, so it starts on a Monday and
// may include a few days of the previous and next month.
const getMonthDays = (cursor) => {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const start = startOfWeek(first);
  const days = [];

  for (
    let day = start;
    day <= last || days.length % 7 !== 0;
    day = addDays(day, 1)
  ) {
    days.push(day);
  }

  return days;
};

const getWeekDays = (cursor) => {
  const start = startOfWeek(cursor);
  return WEEKDAYS.map((_, index) => addDays(start, index));
};

function EventChip({ event }) {
  return (
    <span className={`event-chip ${event.type}`}>
      <Icon name={EVENT_TYPES[event.type].icon} size={11} />
      {event.dateTime && `${formatTime(event.dateTime)} `}
      {event.title}
    </span>
  );
}

// One entry in the side panel: kind and time on the first line, then who
// it is with and the details underneath.
function EventRow({ event, when, onOpen }) {
  return (
    <li>
      <button type="button" onClick={onOpen}>
        <span className="calendar-day-list-top">
          <span className={`event-chip ${event.type}`}>
            <Icon name={EVENT_TYPES[event.type].icon} size={12} />
            {EVENT_TYPES[event.type].label}
          </span>

          <span className="calendar-day-list-time">{when}</span>
        </span>

        <span className="calendar-day-list-text">
          <strong>{event.title}</strong>
          <span>{event.detail}</span>
        </span>
      </button>
    </li>
  );
}

// Month and week views of everything with a date: applications,
// interviews, follow-ups and deadlines. The panel on the right shows the
// selected day and what is coming next.
function CalendarPage() {
  const {
    jobs,
    interviews,
    loading,
    onView,
    onEditInterview,
    onAddOnDate,
    onAddInterviewOnDate,
  } = useOutletContext();

  const [view, setView] = useState("month");
  // Any date inside the month / week being shown.
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [hiddenTypes, setHiddenTypes] = useState([]);

  const today = todayISO();
  const isShortWindow = useShortWindow();
  const maxChips = isShortWindow ? 1 : 2;

  const allEvents = useMemo(
    () => buildEvents(jobs, interviews),
    [jobs, interviews]
  );

  // Group the visible kinds of event by day: { "2026-11-20": [event, ...] }
  const eventsByDate = useMemo(() => {
    const grouped = {};

    allEvents
      .filter((event) => !hiddenTypes.includes(event.type))
      .forEach((event) => {
        (grouped[event.date] ||= []).push(event);
      });

    return grouped;
  }, [allEvents, hiddenTypes]);

  const days = view === "month" ? getMonthDays(cursor) : getWeekDays(cursor);

  // First and last day being shown, as "YYYY-MM-DD" (these compare
  // correctly as plain text).
  const rangeStart =
    view === "month"
      ? toISODate(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
      : toISODate(days[0]);
  const rangeEnd =
    view === "month"
      ? toISODate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0))
      : toISODate(days[6]);

  // How many events of each kind fall inside the month / week on screen.
  const countsInView = {};

  allEvents.forEach((event) => {
    if (event.date >= rangeStart && event.date <= rangeEnd) {
      countsInView[event.type] = (countsInView[event.type] || 0) + 1;
    }
  });

  // The next few things that need attention (not past applications).
  const upcoming = useMemo(
    () =>
      allEvents
        .filter(
          (event) =>
            event.type !== "application" &&
            event.date >= today &&
            !(event.type === "interview" && event.interview.outcome !== "Scheduled")
        )
        .slice(0, UPCOMING_LIMIT),
    [allEvents, today]
  );

  const title =
    view === "month"
      ? cursor.toLocaleString("en", { month: "long", year: "numeric" })
      : `${formatDate(toISODate(days[0]))} – ${formatDate(toISODate(days[6]))}`;

  const move = (direction) =>
    setCursor((current) =>
      view === "month"
        ? new Date(current.getFullYear(), current.getMonth() + direction, 1)
        : addDays(current, direction * 7)
    );

  const goToDate = (isoDate) => {
    setCursor(parseISODate(isoDate));
    setSelectedDate(isoDate);
  };

  const toggleType = (type) =>
    setHiddenTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    );

  const openEvent = (event) => {
    if (event.type === "interview") onEditInterview(event.interview);
    else if (event.job) onView(event.job);
  };

  const selectedEvents = eventsByDate[selectedDate] || [];

  return (
    <>
      <div className="page-intro">
        <div>
          <h2>Calendar</h2>
          <p>Applications, interviews, follow-ups and deadlines by date.</p>
        </div>
      </div>

      <div className="calendar-layout">
        <section className="applications-section calendar-main">
          <div className="calendar-toolbar">
            <div className="calendar-nav">
              <button
                type="button"
                onClick={() => move(-1)}
                aria-label={`Previous ${view}`}
              >
                ←
              </button>
              <button type="button" onClick={() => goToDate(todayISO())}>
                Today
              </button>
              <button
                type="button"
                onClick={() => move(1)}
                aria-label={`Next ${view}`}
              >
                →
              </button>

              <h2 aria-live="polite">{title}</h2>
            </div>

            {/* The legend doubles as a filter and shows this period's
                totals. */}
            <div
              className="calendar-legend"
              role="group"
              aria-label="Show events"
            >
              {Object.entries(EVENT_TYPES).map(([type, config]) => (
                <button
                  key={type}
                  type="button"
                  className={`event-chip ${type} ${
                    hiddenTypes.includes(type) ? "off" : ""
                  }`}
                  aria-pressed={!hiddenTypes.includes(type)}
                  onClick={() => toggleType(type)}
                >
                  <Icon name={config.icon} size={12} />
                  {config.label}
                  <b>{countsInView[type] || 0}</b>
                </button>
              ))}
            </div>

            <div className="calendar-views" role="group" aria-label="View">
              {["month", "week"].map((option) => (
                <button
                  key={option}
                  type="button"
                  className={view === option ? "active" : ""}
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                >
                  {option === "month" ? "Month" : "Week"}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <EmptyState text="Loading calendar..." />
          ) : (
            <div
              className={`calendar-grid ${view}`}
              // How many weeks are shown; the CSS divides the free height
              // of the window by this number.
              style={{ "--calendar-rows": days.length / 7 }}
            >
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="calendar-weekday">
                  {weekday}
                </div>
              ))}

              {days.map((day) => {
                const iso = toISODate(day);
                const events = eventsByDate[iso] || [];
                const limit = view === "month" ? maxChips : events.length;
                const weekday = day.getDay();

                const classes = [
                  "calendar-day",
                  view === "month" && day.getMonth() !== cursor.getMonth()
                    ? "outside"
                    : "",
                  weekday === 0 || weekday === 6 ? "weekend" : "",
                  iso === today ? "today" : "",
                  iso === selectedDate ? "selected" : "",
                ].join(" ");

                return (
                  <button
                    key={iso}
                    type="button"
                    className={classes}
                    aria-pressed={iso === selectedDate}
                    aria-label={`${formatDate(iso)}, ${events.length} event${
                      events.length === 1 ? "" : "s"
                    }`}
                    onClick={() => setSelectedDate(iso)}
                  >
                    <span className="calendar-day-number">
                      {day.getDate()}
                    </span>

                    <span className="calendar-day-events">
                      {events.slice(0, limit).map((event) => (
                        <EventChip key={event.key} event={event} />
                      ))}

                      {events.length > limit && (
                        <span className="calendar-more">
                          +{events.length - limit} more
                        </span>
                      )}
                    </span>

                    {/* Phones: dots instead of text chips. */}
                    <span className="calendar-day-dots" aria-hidden="true">
                      {events.slice(0, 4).map((event) => (
                        <i key={event.key} className={event.type} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* SIDE PANEL: the selected day, then what is coming next */}
        {!loading && (
          <aside className="calendar-side">
            <section className="applications-section">
              <p className="calendar-side-label">
                {selectedDate === today ? "Today" : relativeDay(selectedDate)}
              </p>

              <h2 className="calendar-side-date">
                {parseISODate(selectedDate).toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </h2>

              {selectedEvents.length === 0 ? (
                <p className="calendar-side-empty">Nothing on this day.</p>
              ) : (
                <ul className="calendar-day-list">
                  {selectedEvents.map((event) => (
                    <EventRow
                      key={event.key}
                      event={event}
                      when={
                        event.dateTime ? formatTime(event.dateTime) : "All day"
                      }
                      onOpen={() => openEvent(event)}
                    />
                  ))}
                </ul>
              )}

              <div className="calendar-side-actions">
                <button
                  type="button"
                  className="edit-action"
                  onClick={() => onAddInterviewOnDate(selectedDate)}
                  disabled={jobs.length === 0}
                  title={
                    jobs.length === 0 ? "Add an application first" : undefined
                  }
                >
                  + Interview
                </button>

                <button
                  type="button"
                  className="edit-action"
                  onClick={() => onAddOnDate(selectedDate)}
                >
                  + Application
                </button>
              </div>
            </section>

            <section className="applications-section">
              <h2 className="calendar-side-heading">Coming up</h2>

              {upcoming.length === 0 ? (
                <p className="calendar-side-empty">
                  Nothing ahead yet. Schedule an interview, or add a follow-up
                  date or deadline to an application, and it will show here.
                </p>
              ) : (
                <ul className="calendar-day-list calendar-upcoming">
                  {upcoming.map((event) => (
                    <EventRow
                      key={event.key}
                      event={event}
                      when={relativeDay(event.date)}
                      // Jump to that day in the calendar.
                      onOpen={() => goToDate(event.date)}
                    />
                  ))}
                </ul>
              )}
            </section>
          </aside>
        )}
      </div>
    </>
  );
}

export default CalendarPage;
