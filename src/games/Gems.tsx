import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { t } from '../i18n';
import { SIZE, adjacent, collapse, findMatches, findMove, kindsOf, newBoard, swapped, type Gem } from './logic/gems';
import { submitResult, useRecords } from './store';
import { playSound } from '../lib/sounds';
import { Result } from './shared';

const MOVES = 25;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/* own gem shapes in the spectrum colours – colour AND shape differ, so they can be told apart without colour */
const COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#ec4899'];
const SHAPES = [
  <circle key="0" cx="20" cy="20" r="14" />,
  <path key="1" d="M20 4 L35 20 L20 36 L5 20 Z" />,
  <path key="2" d="M20 5 L36 33 L4 33 Z" />,
  <rect key="3" x="6" y="6" width="28" height="28" rx="6" />,
  <path key="4" d="M20 3l4.9 10.6 11.6 1.3-8.6 7.9 2.4 11.4L20 28.4 9.7 34.2l2.4-11.4-8.6-7.9 11.6-1.3z" />,
  <path key="5" d="M20 4 L34 12 L34 28 L20 36 L6 28 L6 12 Z" />,
];

function GemShape({ kind }: { kind: number }) {
  return (
    <svg viewBox="0 0 40 40" className="gem-svg" aria-hidden>
      <defs>
        <linearGradient id={`gem-g${kind}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill={COLORS[kind]}>{SHAPES[kind]}</g>
      <g fill={`url(#gem-g${kind})`}>{SHAPES[kind]}</g>
    </svg>
  );
}

/** Gem row: swap neighbours, three in a row vanish. 25 moves, record = points. */
export function Gems({ player }: { player: string }) {
  const [board, setBoard] = useState<Gem[]>(() => newBoard());
  const [selected, setSelected] = useState<number | null>(null);
  const [popping, setPopping] = useState<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(MOVES);
  const [combo, setCombo] = useState(0);
  const [hint, setHint] = useState<[number, number] | null>(null);
  const [end, setEnd] = useState<{ record: boolean } | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const swipe = useRef<{ i: number; x: number; y: number; done: boolean } | null>(null);
  /** a swipe already swapped – the click that follows it must not select */
  const swiped = useRef(false);
  const best = useRecords().gems?.[player];

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // after a quiet while: show a possible move
  useEffect(() => {
    if (end) return;
    const id = window.setTimeout(() => setHint(findMove(kindsOf(board))), 9000);
    return () => window.clearTimeout(id);
  }, [board, end]);

  const resolve = async (b: Gem[], movesLeft: number, total: number) => {
    let current = b;
    let chain = 1;
    for (;;) {
      const m = findMatches(kindsOf(current));
      if (!m.size) break;
      setCombo(chain);
      setPopping(m);
      playSound('gameMatch');
      await sleep(320);
      if (!alive.current) return;
      total += m.size * 10 * chain;
      setScore(total);
      const next = collapse(current, m);
      current = next.board;
      setFresh(next.fresh);
      setPopping(new Set());
      setBoard(current);
      await sleep(520);
      if (!alive.current) return;
      chain++;
    }
    setCombo(0);
    // no move left on the board: a new board, points and moves stay
    if (!findMove(kindsOf(current))) {
      current = newBoard();
      setFresh(new Set(current.map((g) => g.id)));
      setBoard(current);
    }
    if (movesLeft <= 0) setEnd({ record: submitResult('gems', player, total, false) });
    busy.current = false;
  };

  const trySwap = async (a: number, b: number) => {
    if (busy.current || end || !adjacent(a, b, SIZE)) return;
    busy.current = true;
    setSelected(null);
    setHint(null);
    const sw = swapped(board, a, b);
    setFresh(new Set());
    setBoard(sw);
    await sleep(340);
    if (!alive.current) return;
    if (!findMatches(kindsOf(sw)).size) {
      setBoard(board);
      await sleep(340);
      busy.current = false;
      return;
    }
    const left = moves - 1;
    setMoves(left);
    await resolve(sw, left, score);
  };

  const tap = (i: number) => {
    if (busy.current || end) return;
    if (selected === null) return setSelected(i);
    if (selected === i) return setSelected(null);
    if (adjacent(selected, i, SIZE)) void trySwap(selected, i);
    else setSelected(i);
  };

  const onDown = (i: number) => (e: RPointerEvent) => {
    swipe.current = { i, x: e.clientX, y: e.clientY, done: false };
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.done) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const cell = e.currentTarget.getBoundingClientRect().width / SIZE;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.35) return;
    s.done = true;
    swiped.current = true;
    const x = s.i % SIZE;
    const y = Math.floor(s.i / SIZE);
    const target =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? x < SIZE - 1
            ? s.i + 1
            : -1
          : x > 0
            ? s.i - 1
            : -1
        : dy > 0
          ? y < SIZE - 1
            ? s.i + SIZE
            : -1
          : y > 0
            ? s.i - SIZE
            : -1;
    if (target >= 0) void trySwap(s.i, target);
  };

  const restart = () => {
    setBoard(newBoard());
    setScore(0);
    setMoves(MOVES);
    setEnd(null);
    setSelected(null);
    setFresh(new Set());
  };

  return (
    <div className="game gems">
      <div className="game-bar">
        <span className="game-stat big">{t('games.gems.score', { n: score })}</span>
        <span className={`game-stat ${moves <= 5 ? 'warn' : ''}`}>{t('games.gems.moves', { n: moves })}</span>
        {combo > 1 && <span className="game-combo">×{combo}</span>}
        <span className="game-spacer" />
        {best !== undefined && <span className="game-stat muted">{t('games.bestScore', { n: best })}</span>}
        <button className="btn" onClick={restart}>
          {t('games.newGame')}
        </button>
      </div>
      <div className="game-stage">
        <div
          className="gems-board"
          onPointerMove={onMove}
          onPointerUp={() => (swipe.current = null)}
          onPointerCancel={() => (swipe.current = null)}
          role="grid"
          aria-label={t('games.gems.name')}
        >
          {board.map((g, i) => (
            <button
              key={g.id}
              className={`gem ${selected === i ? 'on' : ''} ${popping.has(i) ? 'pop' : ''} ${fresh.has(g.id) ? 'fresh' : ''} ${
                hint?.includes(i) ? 'hint' : ''
              }`}
              style={{ '--x': i % SIZE, '--y': Math.floor(i / SIZE) } as CSSProperties}
              onPointerDown={onDown(i)}
              onClick={() => {
                if (swiped.current) {
                  swiped.current = false;
                  return;
                }
                tap(i);
              }}
              aria-label={`${(i % SIZE) + 1}/${Math.floor(i / SIZE) + 1}`}
            >
              <GemShape kind={g.kind} />
            </button>
          ))}
        </div>
        {end && (
          <Result won title={t('games.gems.over')} text={t('games.gems.score', { n: score })} record={end.record} onAgain={restart} />
        )}
      </div>
      <p className="game-hint">{t('games.gems.hint')}</p>
    </div>
  );
}
