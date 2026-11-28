import { useEffect } from 'react';
import { t } from '../i18n';
import { useStore } from '../store';
import { playSound } from '../lib/sounds';
import { Avatar } from '../components/Avatar';
import { GUEST, setPlayer } from './store';

/** End of a round: won or not, a new record, play again. Lies over the board. */
export function Result({
  won,
  title,
  text,
  record,
  onAgain,
}: {
  won: boolean;
  title: string;
  text: string;
  record?: boolean;
  onAgain: () => void;
}) {
  useEffect(() => {
    playSound(won ? (record ? 'gameRecord' : 'gameWin') : 'gameLose');
  }, [won, record]);

  return (
    <div className={`game-result ${won ? 'won' : 'lost'}`} role="status">
      <div className="game-result-card">
        <div className="game-result-icon" aria-hidden>
          {won ? '🎉' : '🙈'}
        </div>
        <h3>{title}</h3>
        <p>{text}</p>
        {record && <p className="game-record">★ {t('games.newBest')}</p>}
        <button className="btn primary" onClick={onAgain}>
          {t('games.again')}
        </button>
      </div>
    </div>
  );
}

/** Who plays? Records are kept per family member (or as guest). */
export function PlayerPicker({ player }: { player: string }) {
  const { members } = useStore();
  return (
    <div className="game-players" role="radiogroup" aria-label={t('games.whoPlays')}>
      <span className="game-players-label">{t('games.whoPlays')}</span>
      {members.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={player === m.id}
          className={`chip ${player === m.id ? 'on' : ''}`}
          style={player === m.id ? { background: `color-mix(in srgb, ${m.color} 22%, var(--surface))`, borderColor: m.color } : undefined}
          onClick={() => setPlayer(m.id)}
        >
          <Avatar member={m} size={28} />
          {m.name}
        </button>
      ))}
      <button
        role="radio"
        aria-checked={player === GUEST}
        className={`chip all ${player === GUEST ? 'on' : ''}`}
        onClick={() => setPlayer(GUEST)}
      >
        {t('games.guest')}
      </button>
    </div>
  );
}
