// Previous / page numbers / Next. `page` starts at 1.
function Pagination({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;

  // Show the first, the last and the pages around the current one;
  // gaps become "…".  e.g.  1 … 4 [5] 6 … 12
  const pages = [];

  for (let number = 1; number <= pageCount; number++) {
    if (number === 1 || number === pageCount || Math.abs(number - page) <= 1) {
      pages.push(number);
    } else if (pages[pages.length - 1] !== "gap") {
      pages.push("gap");
    }
  }

  return (
    <nav className="pagination" aria-label="Pages">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
      >
        ← Previous
      </button>

      {pages.map((item, index) =>
        item === "gap" ? (
          <span key={`gap-${index}`} className="pagination-gap">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={item === page ? "active" : ""}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onChange(item)}
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page === pageCount}
      >
        Next →
      </button>
    </nav>
  );
}

export default Pagination;
