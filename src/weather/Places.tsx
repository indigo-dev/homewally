import { useEffect, useState } from 'react';
import { Modal } from '../components/Modal';
import {
  LocateError,
  addPlace,
  locate,
  makeHome,
  removePlace,
  renamePlace,
  searchPlaces,
  setActivePlace,
  useWeatherSettings,
  type Place,
  type SearchHit,
} from '../lib/weather';
import { openAndroidSettings } from '../native/launcher';
import { t } from '../i18n';

export function PlacesSheet({ onClose }: { onClose: () => void }) {
  const { places, activeId } = useWeatherSettings();
  return (
    <Modal onClose={onClose} layerClass="wx-sheet-backdrop" label={t('weather.places')}>
      <div className="wx-sheet">
        <div className="wx-sheet-head">
          <h2>{t('weather.places')}</h2>
          <button className="btn primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
        <ul className="wx-places">
          {places.map((p, i) => (
            <PlaceRow key={p.id} place={p} home={i === 0} active={p.id === (activeId ?? places[0]?.id)} />
          ))}
        </ul>
        <p className="wx-hint">{t('weather.homeHint')}</p>
        <h3 className="wx-h">{t('weather.addPlace')}</h3>
        <AddPlace onAdded={onClose} />
      </div>
    </Modal>
  );
}

function PlaceRow({ place, home, active }: { place: Place; home: boolean; active: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(place.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const save = () => {
    const n = name.trim();
    if (n) renamePlace(place.id, n);
    setEditing(false);
  };
  return (
    <li className={active ? 'on' : ''}>
      <div className="wx-place-line">
        {editing ? (
          <input
            className="wx-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            onBlur={save}
            aria-label={t('weather.placeName')}
          />
        ) : (
          <button className="wx-place-name" onClick={() => setActivePlace(place.id)}>
            {home && <span aria-label={t('weather.home')}>🏠 </span>}
            {place.name}
            {place.region && <small>{place.region}</small>}
          </button>
        )}
      </div>
      <div className="wx-place-tools">
        {!home && (
          <button className="btn" onClick={() => makeHome(place.id)}>
            {t('weather.makeHome')}
          </button>
        )}
        <button className="btn" onClick={() => (editing ? save() : setEditing(true))}>
          {editing ? t('common.save') : t('weather.rename')}
        </button>
        <button
          className={`btn danger ${confirmDel ? 'primary' : ''}`}
          onClick={() => (confirmDel ? removePlace(place.id) : setConfirmDel(true))}
          onBlur={() => setConfirmDel(false)}
        >
          {confirmDel ? t('weather.reallyRemove') : t('common.remove')}
        </button>
      </div>
    </li>
  );
}

export function AddPlace({ first = false, onAdded }: { first?: boolean; onAdded?: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; help?: string[]; canOpenSettings?: boolean } | null>(null);

  // search while typing (debounced)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(q, ctrl.signal)
        .then((h) => setHits(h))
        .catch((e) => e.name !== 'AbortError' && setHits([]));
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const useLocation = async () => {
    setBusy(true);
    setError(null);
    try {
      const pos = await locate();
      addPlace({ name: first ? t('weather.home') : t('weather.myLocation'), ...pos });
      onAdded?.();
    } catch (e) {
      setError({
        message: (e as Error).message,
        help: e instanceof LocateError ? e.help : undefined,
        canOpenSettings: e instanceof LocateError && e.canOpenSettings,
      });
    } finally {
      setBusy(false);
    }
  };

  const pick = (h: SearchHit) => {
    addPlace(h);
    setQuery('');
    setHits(null);
    onAdded?.();
  };

  return (
    <div className="wx-add">
      <button className={`btn ${first ? 'primary' : ''} wx-locate`} onClick={useLocation} disabled={busy}>
        📍 {busy ? t('weather.locating') : t('weather.useLocation')}
      </button>
      {error && (
        <div className="wx-error">
          <b>{error.message}</b>
          {error.help && (
            <ol>
              {error.help.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ol>
          )}
          {error.canOpenSettings && (
            <button className="btn" onClick={() => openAndroidSettings('app')}>
              {t('weather.locate.openAppSettings')}
            </button>
          )}
        </div>
      )}
      <input
        className="wx-input"
        type="search"
        placeholder={t('weather.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        enterKeyHint="search"
        autoComplete="off"
        aria-label={t('weather.searchLabel')}
      />
      {hits && query.trim().length >= 2 && (
        <ul className="wx-hits">
          {hits.length === 0 && (
            <li className="muted wx-nohit">{/^\d+$/.test(query.trim()) ? t('weather.postcode') : t('weather.noHit')}</li>
          )}
          {hits.map((h) => (
            <li key={`${h.lat},${h.lon}`}>
              <button onClick={() => pick(h)}>
                {h.name}
                {h.region && <small>{h.region}</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
