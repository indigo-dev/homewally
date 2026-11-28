/** Line icons for the modern styles. The classic style keeps its emoji / text glyphs (see `.ui-glyph`). */
const PATHS = {
  back: <path d="M15 5l-7 7 7 7" />,
  forward: <path d="M9 5l7 7-7 7" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />,
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="8" height="10" rx="2" />
      <rect x="13" y="3" width="8" height="6" rx="2" />
      <rect x="3" y="15" width="8" height="6" rx="2" />
      <rect x="13" y="11" width="8" height="10" rx="2" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  timetable: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 9h18M9 9v11M15 9v11" />
    </>
  ),
  todos: <path d="M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8" />,
  shopping: (
    <>
      <path d="M3 4h2l2.4 11h11l2-8H6.2" />
      <circle cx="9.5" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </>
  ),
  weather: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 2.5v1.3M2.5 9h1.3M4.4 4.4l.9.9M13.6 4.4l-.9.9" />
      <path d="M8 20h9.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 8 20z" />
    </>
  ),
  games: (
    <>
      <rect x="2.5" y="7" width="19" height="11" rx="5.5" />
      <path d="M7.5 10.5v4M5.5 12.5h4" />
      <circle cx="15.5" cy="11" r="1" />
      <circle cx="17.5" cy="14" r="1" />
    </>
  ),
  apps: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </>
  ),
  frame: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
      <circle cx="15.5" cy="8.5" r="1.5" />
    </>
  ),
  // settings sections
  family: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M15.8 14.6A4.6 4.6 0 0 1 20.5 19" />
    </>
  ),
  holidays: (
    <>
      <path d="M12 4a8.5 8.5 0 0 1 8.5 8.5h-17A8.5 8.5 0 0 1 12 4z" />
      <path d="M12 12.5V20M8 20.5h8" />
    </>
  ),
  school: (
    <>
      <path d="M6 10.5a6 6 0 0 1 12 0V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M9.5 4.6V4a2.5 2.5 0 0 1 5 0v.6M9 14h6v3.5H9z" />
    </>
  ),
  design: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18 1.8 1.8 0 0 0 1.3-3.1 1.8 1.8 0 0 1 1.3-3.1h2.3A4.1 4.1 0 0 0 21 10.7C20.6 6.4 16.7 3 12 3z" />
      <circle cx="7.6" cy="11" r="1" />
      <circle cx="10" cy="7.3" r="1" />
      <circle cx="14.6" cy="7.6" r="1" />
    </>
  ),
  view: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4M7 14h4M7 17.5h7" />
    </>
  ),
  device: (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="3" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  voice: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  backup: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

/** Text glyph for the classic style plus the line icon for the others. */
export function GlyphIcon({ glyph, name }: { glyph: string; name: IconName }) {
  return (
    <>
      <span className="ui-glyph" aria-hidden>
        {glyph}
      </span>
      <Icon name={name} />
    </>
  );
}

/** Minimal inline house mark shown on events from the local family calendar. */
export function LocalMark({ title }: { title?: string }) {
  return (
    <span className="local-mark" title={title} aria-hidden>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 7.5 8 3l5.5 4.5" />
        <path d="M4.2 6.8V13h7.6V6.8" />
      </svg>
    </span>
  );
}
