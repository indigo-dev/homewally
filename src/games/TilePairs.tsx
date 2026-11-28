import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { useSize } from '../lib/hooks';
import { softly, vtItem } from '../lib/transition';
import { Sym } from '../components/Sym';
import { LAYOUT, findPair, isFree, newDeal, reshuffle } from './logic/tiles';
import { clockTime, submitResult, useRecords } from './store';
import { playSound } from '../lib/sounds';
import { Result } from './shared';
import { nowMs } from './time';

/** the 18 pictures (from the bundled symbol sets, so they follow the chosen symbol style) */
const PICTURES = ['🍎', '🍐', '🍋', '🍇', '🍓', '🍊', '🥕', '🌽', '🍄', '🥦', '🥑', '🍉', '🍍', '🥝', '🫐', '🐱', '🐶', '🐻'];

const COLS = 20; // half-tile steps across (10 tiles)
const ROWS = 8; // half-tile steps down (4 tiles)
const TALL = 1.25; // a tile is 25 % taller than wide

/** Tile pairs: take away two equal free tiles. Record = best time. */
export function TilePairs({ player }: { player: string }) {
  const [tiles, setTiles] = useState<Map<number, number>>(() => newDeal());
  const [history, setHistory] = useState<[number, number, number][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<[number, number] | null>(null);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [end, setEnd] = useState<{ seconds: number; record: boolean } | null>(null);
  const [stageRef, size] = useSize<HTMLDivElement>();
  const records = useRecords();
  const best = records.tiles?.[player];

  useEffect(() => {
    if (end) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [end]);

  const taken = useMemo(() => new Set(tiles.keys()), [tiles]);
  const free = useMemo(() => new Set([...taken].filter((i) => isFree(i, taken))), [taken]);
  const stuck = tiles.size > 0 && !findPair(tiles);

  const restart = () => {
    softly(() => {
      setTiles(newDeal());
      setHistory([]);
      setSelected(null);
      setHint(null);
      setEnd(null);
    });
  };

  const tap = (i: number) => {
    if (!free.has(i) || end) return;
    setHint(null);
    if (selected === null || selected === i) return setSelected(selected === i ? null : i);
    if (tiles.get(selected) !== tiles.get(i)) return setSelected(i);
    const a = selected;
    const kind = tiles.get(i)!;
    const next = new Map(tiles);
    next.delete(a);
    next.delete(i);
    softly(
      () => {
        setTiles(next);
        setHistory((h) => [...h, [a, i, kind]]);
        setSelected(null);
      },
      { items: true },
    );
    if (next.size === 0) {
      const s = Math.max(1, Math.round((nowMs() - started) / 1000));
      setEnd({ seconds: s, record: submitResult('tiles', player, s, true) });
    } else {
      playSound('gameMatch');
    }
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    softly(
      () => {
        setTiles((cur) => new Map(cur).set(last[0], last[2]).set(last[1], last[2]));
        setHistory((h) => h.slice(0, -1));
        setSelected(null);
      },
      { items: true },
    );
  };

  // the board as large as the stage allows
  const u = Math.max(8, Math.min(size.width / (COLS + 1), size.height / (ROWS * TALL + 1.2)));
  const depth = u * 0.16;

  return (
    <div className="game tiles">
      <div className="game-bar">
        <button className="btn" onClick={() => setHint(findPair(tiles))} disabled={!!end}>
          💡 {t('games.tiles.hint')}
        </button>
        <button className="btn" onClick={undo} disabled={!history.length || !!end}>
          ↶ {t('games.tiles.undo')}
        </button>
        <button className="btn" onClick={() => softly(() => setTiles((cur) => reshuffle(cur)), { items: true })} disabled={!!end}>
          🔀 {t('games.tiles.shuffle')}
        </button>
        <span className="game-spacer" />
        <span className="game-stat">{t('games.tiles.left', { n: tiles.size })}</span>
        <span className="game-stat">⏱ {clockTime(Math.floor(((end ? started + end.seconds * 1000 : now) - started) / 1000))}</span>
        {best !== undefined && <span className="game-stat muted">{t('games.bestTime', { time: clockTime(best) })}</span>}
      </div>
      <div className="game-stage" ref={stageRef}>
        <div className="tiles-board" style={{ width: COLS * u + depth * 3, height: ROWS * TALL * u + depth * 3 }}>
          {[...tiles].map(([i, kind]) => {
            const s = LAYOUT[i];
            const isFreeTile = free.has(i);
            return (
              <button
                key={i}
                className={`tile vt-item ${isFreeTile ? 'free' : 'blocked'} ${selected === i ? 'on' : ''} ${hint?.includes(i) ? 'hint' : ''}`}
                style={{
                  ...vtItem(`tile-${i}`),
                  left: s.x * u + s.z * depth,
                  top: s.y * TALL * u - s.z * depth + depth * 2,
                  width: 2 * u,
                  height: 2 * TALL * u,
                  zIndex: s.z * 100 + s.y * 4 + Math.round(s.x / 2),
                  fontSize: u * 1.25,
                }}
                onClick={() => tap(i)}
                aria-label={PICTURES[kind]}
                aria-pressed={selected === i}
                disabled={!isFreeTile}
              >
                <Sym emoji={PICTURES[kind]} />
              </button>
            );
          })}
        </div>
        {stuck && !end && (
          <div className="game-banner">
            <span>{t('games.tiles.stuck')}</span>
            <button className="btn primary" onClick={() => softly(() => setTiles((cur) => reshuffle(cur)), { items: true })}>
              🔀 {t('games.tiles.shuffle')}
            </button>
          </div>
        )}
        {end && (
          <Result
            won
            title={t('games.won')}
            text={t('games.tiles.time', { time: clockTime(end.seconds) })}
            record={end.record}
            onAgain={restart}
          />
        )}
      </div>
      <p className="game-hint">{t('games.tiles.rule')}</p>
    </div>
  );
}
