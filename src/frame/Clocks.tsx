import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ClockFace } from '../lib/frame';
import { useStore } from '../store';
import { proxyOf, useEvents } from '../lib/events';
import { useMinute, useToday } from '../lib/clock';
import { addDays, fmtTime, uses12h } from '../lib/dates';
import type { CalEvent } from '../types';
import { wordTime } from '../lib/wordTime';
import { t } from '../i18n';

/*
 * Clocks for the photo frame / screensaver. Sizes come from CSS variables on a parent
 * (--dig: digit height, --ana: diameter of the analog dials), so the same component serves
 * the full-screen frame and the small previews in the settings.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function Clock({ face, now, seconds, still }: { face: ClockFace; now: Date; seconds: boolean; still?: boolean }) {
  // a 12-hour locale (en-US) gets 1–12 on the digital faces
  const h12 = uses12h();
  const hours = h12 ? ((now.getHours() + 11) % 12) + 1 : now.getHours();
  const hh = pad(hours);
  const mm = pad(now.getMinutes());
  switch (face) {
    case 'none':
      return null;
    case 'd-light':
      return (
        <div className="ck-digital ck-light">
          {h12 ? hours : hh}
          <span className="ck-colon">:</span>
          {mm}
        </div>
      );
    case 'd-bold':
      return (
        <div className="ck-digital ck-bold">
          <span>{hh}</span>
          <span>{mm}</span>
        </div>
      );
    case 'd-flip':
      return (
        <div className="ck-digital ck-flip">
          {/* a new key re-runs the flip animation when the value changes */}
          <span className="ck-card" key={`h${hh}`}>
            {hh}
          </span>
          <span className="ck-card" key={`m${mm}`}>
            {mm}
          </span>
        </div>
      );
    case 'd-words': {
      const { phrase, dots } = wordTime(now);
      return (
        <div className="ck-digital ck-words">
          <span className="ck-words-lead">{t('frame.itIs')}</span>
          <span className="ck-words-main">{phrase}</span>
          <span className="ck-words-dots" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className={i < dots ? 'on' : ''} />
            ))}
          </span>
        </div>
      );
    }
    default:
      return <Analog face={face} now={now} seconds={seconds} still={still} />;
  }
}

/* ------------------------------------------------------------------ analog dials */

const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) };
};

function Hand({ angle, len, tail = 0, className }: { angle: number; len: number; tail?: number; className: string }) {
  return <line className={className} x1={100} y1={100 + tail} x2={100} y2={100 - len} transform={`rotate(${angle} 100 100)`} />;
}

function Analog({ face, now, seconds, still }: { face: ClockFace; now: Date; seconds: boolean; still?: boolean }) {
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const hourA = (h + m / 60) * 30;
  const minA = m * 6;
  // the second hand turns by CSS; it starts where the real second hand is right now
  // eslint-disable-next-line react-hooks/purity -- read once per minute render on purpose
  const secDelay = still ? 0 : -((Date.now() % 60_000) / 1000);
  const secStyle = (still ? { transform: 'rotate(192deg)' } : { animationDelay: `${secDelay}s` }) as CSSProperties;

  const ticks = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);
  const cls = `ck-analog ck-${face}`;

  return (
    <svg className={cls} viewBox="0 0 200 200" aria-hidden>
      {face === 'a-classic' && (
        <>
          <circle className="ck-dial" cx={100} cy={100} r={96} />
          {ticks.map((i) => {
            const big = i % 5 === 0;
            const a = polar(i * 6, big ? 76 : 86);
            const b = polar(i * 6, 91);
            return <line key={i} className={big ? 'ck-tick-h' : 'ck-tick-m'} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </>
      )}
      {face === 'a-minimal' &&
        Array.from({ length: 12 }, (_, i) => {
          const a = polar(i * 30, i % 3 === 0 ? 78 : 86);
          const b = polar(i * 30, 94);
          return <line key={i} className="ck-tick-h" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      {face === 'a-dots' && (
        <>
          <circle className="ck-dial" cx={100} cy={100} r={97} />
          {Array.from({ length: 12 }, (_, i) => {
            const p = polar(i * 30, 82);
            return <circle key={i} className="ck-dot" cx={p.x} cy={p.y} r={i % 3 === 0 ? 5.5 : 3.2} />;
          })}
        </>
      )}
      {face === 'a-roman' && (
        <>
          <circle className="ck-dial" cx={100} cy={100} r={96} />
          <circle className="ck-ring" cx={100} cy={100} r={89} />
          {ROMAN.map((n, i) => {
            const p = polar(i * 30, 72);
            return (
              <text key={n} className="ck-num" x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central">
                {n}
              </text>
            );
          })}
          {ticks.map((i) => {
            const a = polar(i * 6, i % 5 === 0 ? 84 : 86);
            const b = polar(i * 6, 89);
            return <line key={i} className="ck-tick-m" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
        </>
      )}

      <Hand className="ck-hour" angle={hourA} len={face === 'a-roman' ? 46 : 50} tail={face === 'a-dots' ? 0 : 12} />
      <Hand className="ck-min" angle={minA} len={face === 'a-roman' ? 70 : 78} tail={face === 'a-dots' ? 0 : 14} />
      {seconds && (
        <g className={still ? 'ck-sec-g' : 'ck-sec-g ck-sec-run'} style={secStyle} key={now.getTime()}>
          <line className="ck-sec" x1={100} y1={120} x2={100} y2={14} />
          {face === 'a-classic' && <circle className="ck-sec-tip" cx={100} cy={36} r={6} />}
        </g>
      )}
      <circle className="ck-hub" cx={100} cy={100} r={face === 'a-minimal' ? 3.5 : 5} />
    </svg>
  );
}

/* ------------------------------------------------------------------ upcoming events */

const MAX_EVENTS = 5;

/** Today's remaining and tomorrow's events of the family, for the screensaver. */
export function FrameEvents() {
  const { settings, members, calendars } = useStore();
  const now = useMinute();
  const today = useToday();
  const range = useMemo(() => ({ start: today, end: addDays(today, 2) }), [today]);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNonce((n) => n + 1), settings.refreshMinutes * 60_000);
    return () => clearInterval(t);
  }, [settings.refreshMinutes]);
  const { events } = useEvents(range, members, calendars, proxyOf(settings), nonce);

  const colorOf = (e: CalEvent) => members.find((m) => e.memberIds.includes(m.id))?.color;
  const tomorrow = addDays(today, 1);
  const visible = events.filter((e) => Boolean(e.birthdayId) || e.memberIds.some((id) => members.some((m) => m.id === id)));
  const groups: [string, CalEvent[]][] = [
    [t('common.today'), visible.filter((e) => e.end > now && e.start < tomorrow)],
    [t('common.tomorrow'), visible.filter((e) => e.start >= tomorrow && e.start < addDays(tomorrow, 1))],
  ];
  let left = MAX_EVENTS;
  const shown = groups
    .map(([label, list]) => {
      const take = list.slice(0, left);
      left -= take.length;
      return [label, take] as [string, CalEvent[]];
    })
    .filter(([, list]) => list.length > 0);

  if (shown.length === 0) return <div className="pf-events pf-events-none">{t('frame.noEvents')}</div>;
  return (
    <div className="pf-events">
      {shown.map(([label, list]) => (
        <div key={label} className="pf-ev-group">
          <div className="pf-ev-label">{label}</div>
          {list.map((e) => {
            const running = !e.allDay && e.start <= now && e.end > now;
            return (
              <div key={e.key} className="pf-ev">
                <i style={{ background: colorOf(e) }} />
                <span className="pf-ev-time">{e.allDay ? t('frame.allDay') : running ? t('dashboard.now') : fmtTime(e.start)}</span>
                <span className="pf-ev-title">{e.title}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
