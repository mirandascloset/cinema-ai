/** SVG symbol sprite matching the classic shell icons. */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute", overflow: "hidden", pointerEvents: "none" }} aria-hidden>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f08a6c" />
          <stop offset=".5" stopColor="#e0508f" />
          <stop offset="1" stopColor="#b524e8" />
        </linearGradient>
      </defs>
      <symbol id="ic-spark" viewBox="0 0 24 24">
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
      </symbol>
      <symbol id="ic-wand" viewBox="0 0 24 24">
        <path d="M4 20L15 9" />
        <path d="M14 4v2M19 9h2M17.5 5.5L19 4M18 13l1.5 1.5M10 5.5L8.5 4" />
      </symbol>
      <symbol id="ic-grid" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
      </symbol>
      <symbol id="ic-image" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <circle cx="9" cy="10" r="2" />
        <path d="M21 16l-5-5-9 9" />
      </symbol>
      <symbol id="ic-list" viewBox="0 0 24 24">
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4.5" cy="6" r="1" />
        <circle cx="4.5" cy="12" r="1" />
        <circle cx="4.5" cy="18" r="1" />
      </symbol>
      <symbol id="ic-shirt" viewBox="0 0 24 24">
        <path d="M9 3l-6 3 2 5 3-1v11h8V10l3 1 2-5-6-3c-.5 1.5-1.6 2.5-3 2.5S9.5 4.5 9 3z" />
      </symbol>
      <symbol id="ic-brush" viewBox="0 0 24 24">
        <path d="M20 4L10 14" />
        <path d="M10 14c-2-.5-4 .5-4.5 2.5S5 20 3 20c3 1.5 7 1 7.5-2.5.2-1.3 0-2.5-.5-3.5z" />
      </symbol>
      <symbol id="ic-star" viewBox="0 0 24 24">
        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
      </symbol>
      <symbol id="ic-person" viewBox="0 0 24 24">
        <circle cx="12" cy="6.5" r="3.5" />
        <path d="M5 21c0-4.4 3.1-7.5 7-7.5s7 3.1 7 7.5" />
      </symbol>
      <symbol id="ic-swap" viewBox="0 0 24 24">
        <circle cx="8" cy="7" r="2.5" />
        <path d="M3.5 18c0-2.8 2-4.8 4.5-4.8" />
        <circle cx="16" cy="7" r="2.5" />
        <path d="M20.5 18c0-2.8-2-4.8-4.5-4.8" />
        <path d="M10 12.5h4.5l-1.4-1.4M14.5 15.5H10l1.4 1.4" />
      </symbol>
      <symbol id="ic-film" viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M10 9.5v5l4.5-2.5z" />
      </symbol>
      <symbol id="ic-detail" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
      </symbol>
      <symbol id="ic-x" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" />
      </symbol>
      <symbol id="ic-heart" viewBox="0 0 24 24">
        <path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 6.8a4.5 4.5 0 0 1 8 2.7c0 6.1-8 11-8 11z" />
      </symbol>
      <symbol id="ic-trash" viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      </symbol>
      <symbol id="ic-plus" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </symbol>
      <symbol id="ic-chev" viewBox="0 0 24 24">
        <path d="M9 6l6 6-6 6" />
      </symbol>
      <symbol id="ic-erase" viewBox="0 0 24 24">
        <path d="M16 4l5 5-10 10H6l-3-3z" />
        <path d="M11 19h9M9 9l6 6" />
      </symbol>
      <symbol id="ic-undo" viewBox="0 0 24 24">
        <path d="M9 14L4 9l5-5" />
        <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
      </symbol>
      <symbol id="ic-redo2" viewBox="0 0 24 24">
        <path d="M15 14l5-5-5-5" />
        <path d="M20 9H10a6 6 0 0 0 0 12h3" />
      </symbol>
      <symbol id="ic-check" viewBox="0 0 24 24">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </symbol>
      <symbol id="ic-cast" viewBox="0 0 24 24">
        <rect x="2.5" y="4" width="19" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </symbol>
      <symbol id="ic-eye" viewBox="0 0 24 24">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="ic-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M12 11v6M12 7.5v.01" />
      </symbol>
      <symbol id="ic-save" viewBox="0 0 24 24">
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </symbol>
      <symbol id="ic-redo" viewBox="0 0 24 24">
        <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />
      </symbol>
      <symbol id="ic-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </symbol>
      <symbol id="ic-folder" viewBox="0 0 24 24">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </symbol>
      <symbol id="ic-back" viewBox="0 0 24 24">
        <path d="M15 5l-7 7 7 7" />
      </symbol>
      <symbol id="ic-text" viewBox="0 0 24 24">
        <path d="M4 6h16M4 10h12M4 14h14M4 18h10" />
      </symbol>
    </svg>
  );
}

export function Icon({ name, className = "i" }: { name: string; className?: string }) {
  return (
    <svg className={className}>
      <use href={`#ic-${name}`} />
    </svg>
  );
}
