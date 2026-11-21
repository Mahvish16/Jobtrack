import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { apiRequest, getErrorMessage } from "../api";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import { formatDate, parseISODate } from "../utils/dates";
import "./AnalyticsPage.css";

// A headline number with a short explanation.
// `trend` (optional) adds an up / down marker in front of the note.
function Tile({ icon, label, value, note, trend }) {
  return (
    <div className="analytics-tile">
      <div className="analytics-tile-top">
        <p>{label}</p>
        <span className="analytics-tile-icon">
          <Icon name={icon} size={16} />
        </span>
      </div>

      <strong>{value}</strong>

      <span className="analytics-tile-note">
        {trend && (
          // An arrow and a word, so the meaning does not rely on colour.
          <b className={`analytics-trend ${trend}`}>
            {trend === "up" ? "▲" : "▼"}
          </b>
        )}
        {note}
      </span>
    </div>
  );
}

// Applications per month as vertical bars. The y-axis always starts at 0.
function MonthlyChart({ months }) {
  const [active, setActive] = useState(null);

  const highest = Math.max(...months.map((month) => month.count), 1);
  // Round the top of the axis up to an even number so the middle
  // grid line is a whole number.
  const top = highest <= 4 ? 4 : Math.ceil(highest / 2) * 2;
  const ticks = [top, top / 2, 0];

  return (
    <>
      <div className="analytics-chart">
        <div className="analytics-chart-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>

        <div className="analytics-chart-plot">
          <div className="analytics-chart-grid" aria-hidden="true">
            {ticks.map((tick) => (
              <i key={tick} />
            ))}
          </div>

          {months.map((month, index) => (
            <div
              key={month.month}
              className={`analytics-chart-column ${
                active === index ? "active" : ""
              }`}
              tabIndex={0}
              role="img"
              aria-label={`${month.label}: ${month.count} application${
                month.count === 1 ? "" : "s"
              }`}
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            >
              {active === index && (
                <div className="analytics-tooltip">
                  <strong>{month.count}</strong>{" "}
                  {month.count === 1 ? "application" : "applications"}
                  <span>{month.label}</span>
                </div>
              )}

              <div className="analytics-chart-bar-area">
                {month.count > 0 && (
                  <div
                    className="analytics-chart-bar"
                    style={{ height: `${(month.count / top) * 100}%` }}
                  />
                )}
              </div>

              <span className="analytics-chart-label">
                {month.label.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* The same numbers as text, for screen readers and exact values. */}
      <details className="analytics-table">
        <summary>View as table</summary>

        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Applications</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <td>{month.label}</td>
                <td>{month.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

// The order of the ring. Neighbouring colours were checked to stay easy to
// tell apart, also for people with colour-blindness (see index.css).
const DONUT_ORDER = ["Applied", "Interview", "Selected", "Interested", "Rejected"];

// A ring split by status. The legend next to it carries the exact numbers,
// so nothing depends on colour alone.
function StatusDonut({ rows, total }) {
  const [active, setActive] = useState(null);

  const RADIUS = 46;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const GAP = 2.2; // small space between slices

  const ordered = DONUT_ORDER.map((status) =>
    rows.find((row) => row.status === status)
  ).filter((row) => row && row.count > 0);

  // Each slice is one circle whose outline is drawn only along its part.
  const slices = ordered.reduce((list, row) => {
    const offset = list.reduce((sum, slice) => sum + slice.length, 0);

    return [
      ...list,
      { ...row, offset, length: (row.count / total) * CIRCUMFERENCE },
    ];
  }, []);

  const shown = active || { status: "Applications", count: total };

  return (
    <div className="analytics-donut">
      <div className="analytics-donut-chart">
        <svg viewBox="0 0 120 120" role="img" aria-label="Applications by status">
          {slices.map((slice) => (
            <circle
              key={slice.status}
              className={`analytics-slice ${slice.status.toLowerCase()} ${
                active && active.status !== slice.status ? "dim" : ""
              }`}
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              strokeWidth="15"
              strokeDasharray={`${Math.max(slice.length - GAP, 0.5)} ${CIRCUMFERENCE}`}
              strokeDashoffset={-slice.offset}
              // Start at the top (12 o'clock) instead of the right.
              transform="rotate(-90 60 60)"
              onMouseEnter={() => setActive(slice)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>

        <div className="analytics-donut-center">
          <strong>{shown.count}</strong>
          <span>{shown.status}</span>
        </div>
      </div>

      <ul className="analytics-legend">
        {DONUT_ORDER.map((status) => {
          const row = rows.find((item) => item.status === status);

          return (
            <li
              key={status}
              className={active?.status === status ? "active" : ""}
              onMouseEnter={() => row.count > 0 && setActive(row)}
              onMouseLeave={() => setActive(null)}
            >
              <i className={`analytics-dot ${status.toLowerCase()}`} />
              <span>{status}</span>
              <strong>{row.count}</strong>
              <small>
                {total ? Math.round((row.count / total) * 100) : 0}%
              </small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Steps that narrow towards the bottom, like a funnel. Each bar is centred
// and as wide as its share of the first step.
function Funnel({ steps }) {
  const first = steps[0]?.count || 0;

  return (
    <ol className="analytics-funnel">
      {steps.map((step, index) => {
        const share = first ? (step.count / first) * 100 : 0;

        return (
          <li key={step.label}>
            <div className="analytics-funnel-label">
              <span>{step.label}</span>
              <strong>
                {step.count} <small>({Math.round(share * 10) / 10}%)</small>
              </strong>
            </div>

            <div className="analytics-funnel-track">
              <div
                className={`analytics-funnel-bar step-${index}`}
                // A sliver stays visible even at zero.
                style={{ width: `${Math.max(share, 2)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// A plain numbered list: 1. Google  3
function RankList({ rows, emptyText }) {
  if (rows.length === 0) return <p className="analytics-empty">{emptyText}</p>;

  return (
    <ol className="analytics-rank">
      {rows.map((row, index) => (
        <li key={row.label}>
          <span className="analytics-rank-number">{index + 1}</span>
          <span className="analytics-rank-label">{row.label}</span>
          <strong>{row.count}</strong>
        </li>
      ))}
    </ol>
  );
}

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "pipeline", label: "Pipeline" },
  { value: "breakdown", label: "Breakdown" },
];

const RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "all", label: "All time" },
];

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Applications per day for the last 12 weeks as a grid of squares:
// one column per week, one row per weekday, darker = more applications.
function ActivityGrid({ days }) {
  const [active, setActive] = useState(null);

  const highest = Math.max(...days.map((day) => day.count), 1);

  // 0 = none, then four steps from light to dark.
  const level = (count) =>
    count === 0 ? 0 : Math.max(1, Math.ceil((count / highest) * 4));

  // Cut the flat list of days into weeks of seven (Monday first).
  const weeks = [];

  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;

  return (
    <>
      <div className="analytics-grid-wrapper">
        <div className="analytics-grid-weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>

        <div
          className="analytics-grid"
          role="img"
          aria-label={`${plural(total, "application")} on ${plural(
            activeDays,
            "day"
          )} in the last 12 weeks`}
          onMouseLeave={() => setActive(null)}
        >
          {weeks.map((week, weekIndex) => (
            <div key={week[0].date} className="analytics-grid-week">
              {/* A month name above the week in which the month starts. */}
              <span className="analytics-grid-month">
                {weekIndex === 0 ||
                week.some((day) => day.date.endsWith("-01"))
                  ? parseISODate(week[week.length - 1].date).toLocaleString(
                      "en",
                      { month: "short" }
                    )
                  : ""}
              </span>

              {week.map((day) => (
                <i
                  key={day.date}
                  className={`level-${level(day.count)} ${
                    active?.date === day.date ? "active" : ""
                  }`}
                  onMouseEnter={() => setActive(day)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="analytics-grid-footer">
        {/* Says in words what the hovered square means. */}
        <p aria-live="polite">
          {active
            ? `${plural(active.count, "application")} on ${formatDate(active.date)}`
            : `${plural(total, "application")} on ${plural(activeDays, "day")}. Hover a square for details.`}
        </p>

        <div className="analytics-grid-legend" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((step) => (
            <i key={step} className={`level-${step}`} />
          ))}
          More
        </div>
      </div>
    </>
  );
}

// The numbers come from GET /api/analytics/, where PostgreSQL does the
// counting with GROUP BY queries.
function AnalyticsPage() {
  const { jobs, interviews, loading } = useOutletContext();

  const [range, setRange] = useState("all");
  const [tab, setTab] = useState("overview");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  // Fetch again whenever the period, applications or interviews change.
  useEffect(() => {
    if (loading) return;

    let isMounted = true;

    apiRequest("get", `/api/analytics/?range=${range}`)
      .then((response) => {
        if (isMounted) {
          setData(response.data);
          setError("");
        }
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(getErrorMessage(requestError, "Unable to load analytics."));
        }
      });

    return () => {
      isMounted = false;
    };
  }, [jobs, interviews, loading, range]);

  // The line under the title: a default, or a one-sentence summary once
  // the numbers are known.
  const intro = (
    subtitle = "How your job search is going, based on your tracked applications."
  ) => (
    <div className="page-intro">
      <div>
        <h2>Application Analytics</h2>
        <p>{subtitle}</p>
      </div>

      <div className="analytics-range" role="group" aria-label="Period">
        {RANGES.map((option) => (
          <button
            key={option.value}
            type="button"
            className={range === option.value ? "active" : ""}
            aria-pressed={range === option.value}
            onClick={() => setRange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (error) {
    return (
      <>
        {intro()}
        <div className="dashboard-error" role="alert">
          {error}
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        {intro()}
        <section className="analytics-section">
          <EmptyState text="Loading analytics..." />
        </section>
      </>
    );
  }

  if (jobs.length === 0) {
    return (
      <>
        {intro()}
        <section className="analytics-section">
          <EmptyState
            title="No data yet"
            text="Add applications to see your trends and conversion rates."
          />
        </section>
      </>
    );
  }

  const { rates, submitted } = data;
  const selected = data.by_status.find((row) => row.status === "Selected").count;
  // This month against last month, in words.
  const difference = data.this_month - data.last_month;
  const trend =
    difference === 0
      ? "same as last month"
      : `${Math.abs(difference)} ${difference > 0 ? "more" : "fewer"} than last month`;

  const periodLabel =
    range === "all"
      ? "all time"
      : `last ${RANGES.find((option) => option.value === range).label}`;

  // One sentence that sums up the most active month.
  const bestMonth = data.monthly.reduce(
    (best, month) => (month.count > best.count ? month : best),
    data.monthly[0]
  );

  const insight =
    bestMonth.count > 0
      ? `${bestMonth.label} was your most active month with ${plural(
          bestMonth.count,
          "application"
        )}. ${
          data.interviews.upcoming > 0
            ? `You have ${plural(data.interviews.upcoming, "interview")} coming up.`
            : selected > 0
              ? `${plural(selected, "application")} ended in an offer.`
              : "Keep going: every application improves your odds."
        }`
      : undefined;

  const topList = (rows, key) =>
    rows.map((row) => ({ label: row[key], count: row.count }));

  return (
    <>
      {intro(insight)}

      <section className="analytics-tiles">
        <Tile
          icon="document"
          label={`Applications · ${periodLabel}`}
          value={data.total}
          note={`${data.this_month} this month, ${trend}`}
          trend={difference > 0 ? "up" : difference < 0 ? "down" : null}
        />
        <Tile
          icon="mail"
          label="Response rate"
          value={`${rates.response_rate}%`}
          note={`${data.responded} of ${submitted} submitted got a reply`}
        />
        <Tile
          icon="users"
          label="Interview rate"
          value={`${rates.interview_rate}%`}
          note={`${data.reached_interview} of ${submitted} reached an interview`}
        />
        <Tile
          icon="clock"
          label="Time to first interview"
          value={
            data.avg_days_to_interview === null
              ? "—"
              : plural(data.avg_days_to_interview, "day")
          }
          note={
            data.avg_days_to_interview === null
              ? "Shown once an interview is recorded"
              : "On average, from applying"
          }
        />
      </section>

      {/* Three tabs keep the page short: one topic on screen at a time. */}
      <div className="analytics-tabs" role="tablist" aria-label="Analytics">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            className={tab === option.value ? "active" : ""}
            onClick={() => setTab(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW: activity over time */}
      {tab === "overview" && (
        <>
          <div className="analytics-columns">
            <section className="analytics-section">
              <h2>Applications per month</h2>
              <p>By applied date, last 12 months.</p>

              <MonthlyChart months={data.monthly} />
            </section>

            <section className="analytics-section">
              <h2>Daily activity</h2>
              <p>Each square is one day, last 12 weeks.</p>

              <ActivityGrid days={data.daily} />
            </section>
          </div>
        </>
      )}

      {tab !== "overview" && data.total === 0 && (
        <section className="analytics-section">
          <EmptyState text="No applications in this period. Choose a longer period above." />
        </section>
      )}

      {/* PIPELINE: where applications stand and how far they get */}
      {tab === "pipeline" && data.total > 0 && (
        <div className="analytics-columns three">
          <section className="analytics-section">
            <h2>Applications by status</h2>
            <p>Where each application currently stands.</p>

            <StatusDonut rows={data.by_status} total={data.total} />
          </section>

          <section className="analytics-section">
            <h2>Conversion funnel</h2>
            <p>How far submitted applications have progressed.</p>

            {submitted === 0 ? (
              <p className="analytics-empty">Nothing submitted yet.</p>
            ) : (
              <Funnel
                steps={[
                  { label: "Submitted", count: submitted },
                  { label: "Got a reply", count: data.responded },
                  {
                    label: "Reached interview",
                    count: data.reached_interview,
                  },
                  { label: "Selected", count: selected },
                ]}
              />
            )}
          </section>

          <section className="analytics-section">
            <h2>Interview outcomes</h2>
            <p>
              Results of the {plural(data.interviews.total, "interview round")}{" "}
              you recorded.
            </p>

            {data.interviews.total === 0 ? (
              <p className="analytics-empty">No interviews recorded yet.</p>
            ) : (
              <ul className="analytics-outcomes">
                {data.interviews.by_outcome.map((row) => (
                  <li key={row.outcome}>
                    <span>{row.outcome}</span>
                    <strong>{row.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* BREAKDOWN: what and where the user applies */}
      {tab === "breakdown" && data.total > 0 && (
        <div className="analytics-columns three">
          <section className="analytics-section">
            <h2>Top companies</h2>
            <p>Applied to most often.</p>

            <RankList rows={topList(data.top_companies, "company_name")} />
          </section>

          <section className="analytics-section">
            <h2>Top roles</h2>
            <p>The job titles you apply for most.</p>

            <RankList rows={topList(data.top_roles, "job_role")} />
          </section>

          <section className="analytics-section">
            <h2>Top locations</h2>
            <p>Where those jobs are based.</p>

            <RankList
              rows={topList(data.top_locations, "location")}
              emptyText="Add a location to your applications to see this."
            />
          </section>
        </div>
      )}
    </>
  );
}

export default AnalyticsPage;
