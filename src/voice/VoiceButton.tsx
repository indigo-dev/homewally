import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { BUILTIN, useShopping } from '../lib/shopping';
import { useTodos } from '../lib/todos';
import { useLocalEvents } from '../lib/localEvents';
import { useWeatherSettings } from '../lib/weather';
import { requestCalendar } from '../lib/calendarNav';
import { fmt } from '../lib/dates';
import { MODULES, type ModuleId } from '../components/ModuleNav';
import { EVERYONE, isEmpty, isQuiet, type Command } from './command';
import { understand, VoiceError, type VoiceInput } from './gemini';
import { MicError, micSupported, startRecording, toModelAudio, type Recording } from './recorder';
import { applyCommand, fillWho, joinAnd, missingWho, whoOf, type Applied } from './apply';
import { EventsAnswer, ShoppingAnswer, TimetableAnswer, TodosAnswer, WeatherAnswer } from './answers';
import { DEFAULT_MODEL, updateVoiceSettings, useVoiceSettings } from './settings';
import './voice.css';
import { t } from '../i18n';
import { speak as speakAloud, stopSpeaking } from '../native/speech';
import { playSound } from '../lib/sounds';

type Phase =
  | { s: 'idle' }
  | { s: 'listening' }
  | { s: 'typing' }
  | { s: 'thinking' }
  /** a request about people named nobody: "Für wen?" – by voice or by tapping a name */
  | { s: 'who'; cmd: Command; inputs: VoiceInput[]; listening: boolean }
  | { s: 'result'; cmd: Command; applied: Applied; undone?: boolean; shown?: string }
  | { s: 'error'; message: string; canType?: boolean; settings?: boolean };

/** how long a result stays open without being touched */
const RESULT_MS = 15_000;
/** "zeig …" only switches the screen: the card is just a short confirmation */
const SHOWN_MS = 4_000;

const MicIcon = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const fromYmd = (s: string) => new Date(`${s}T00:00`);

/** Always reachable microphone button plus the card that shows what was understood and done. */
export function VoiceButton({ onOpenModule, onSettings }: { onOpenModule: (id: ModuleId) => void; onSettings: () => void }) {
  const voice = useVoiceSettings();
  const { members, settings, selectMembers } = useStore();
  const shop = useShopping();
  const todos = useTodos();
  const localCal = useLocalEvents();
  const { places } = useWeatherSettings();
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState('');
  const rec = useRef<Recording | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** counts every new step; an older async step that finishes late sees it changed and gives up */
  const step = useRef(0);
  const [touched, setTouched] = useState(0);

  const speak = useCallback(
    (text: string) => {
      if (voice.speak) void speakAloud(text);
    },
    [voice.speak],
  );

  const close = useCallback(() => {
    step.current++;
    rec.current?.cancel();
    rec.current = null;
    abort.current?.abort();
    stopSpeaking();
    setPhase({ s: 'idle' });
    setTyped('');
  }, []);

  // results close by themselves after a while
  useEffect(() => {
    if (phase.s !== 'result') return;
    const t = setTimeout(close, isQuiet(phase.cmd) ? SHOWN_MS : RESULT_MS);
    return () => clearTimeout(t);
  }, [phase, touched, close]);

  // Escape closes the card
  useEffect(() => {
    if (phase.s === 'idle') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase.s, close]);

  const moduleLabel = (id: ModuleId) => MODULES.find((m) => m.id === id)?.label ?? id;

  /** carries out a complete command: changes, screen, answers */
  const finish = (cmd: Command) => {
    const applied = applyCommand(cmd, {
      items: [...BUILTIN, ...shop.custom],
      list: shop.list,
      add: shop.add,
      setQty: shop.setQty,
      createItem: shop.createItem,
      removeItem: shop.removeItem,
      check: shop.check,
      restore: shop.restore,
      members,
      todos: todos.todos,
      upsertTodo: todos.upsert,
      removeTodo: todos.remove,
      localCalendarEnabled: settings.localCalendarEnabled,
      localEvents: localCal.events,
      upsertLocalEvent: localCal.upsert,
      removeLocalEvent: localCal.remove,
    });

    let shown: string | undefined;
    if (cmd.show) {
      const { module, view, date } = cmd.show;
      const who = whoOf(members, cmd.show.members);
      // "Stundenplan von Jan": the person filter decides what the module shows
      if (who.length) selectMembers(who.map((m) => m.id));
      if (module === 'calendar') requestCalendar({ view, date: date ? fromYmd(date) : undefined });
      onOpenModule(module);
      const label = moduleLabel(module);
      shown =
        who.length && who.length < members.length
          ? t('voice.openedFor', { module: label, names: joinAnd(who.map((m) => m.name)) })
          : t('voice.opened', { module: label });
      if (view) shown += ` · ${t(`calendar.views.${view}`)}`;
      if (date) shown += ` · ${fmt(fromYmd(date), { day: 'numeric', month: 'long', year: 'numeric' })}`;
    }

    setPhase({ s: 'result', cmd, applied, shown });
    if (applied.lines.length > 0) playSound('voiceOk');
    // "zeig …" says nothing; questions speak in their answers
    const said = [...applied.speech];
    if (cmd.reply) said.push(cmd.reply);
    else if (isEmpty(cmd)) said.push(t('voice.notUnderstood'));
    if (said.length) speak(said.join(' '));
  };

  const run = async (inputs: VoiceInput[], followUp = false) => {
    const my = ++step.current;
    setPhase({ s: 'thinking' });
    const ctrl = new AbortController();
    abort.current = ctrl;
    const hidden = new Set(shop.hidden);
    try {
      const { cmd, model } = await understand(
        inputs,
        {
          now: new Date(),
          members: members.map((m) => m.name),
          places: places.map((p) => p.name),
          pantry: [...BUILTIN.filter((i) => !hidden.has(i.id)), ...shop.custom].map((i) => i.name),
          todos: todos.todos
            .filter((x) => !x.done)
            .slice(0, 40)
            .map((x) => x.text),
          localEvents: settings.localCalendarEnabled ? localCal.events.slice(0, 40).map((e) => `${e.title} (${e.date})`) : [],
          localCalendarEnabled: settings.localCalendarEnabled,
        },
        { apiKey: voice.apiKey, model: voice.model, fallbackModel: DEFAULT_MODEL },
        ctrl.signal,
      );
      // the chosen model was gone and the default answered: keep using that
      if (model !== voice.model) updateVoiceSettings({ model });
      if (ctrl.signal.aborted || step.current !== my) return;
      if (!cmd.transcript && isEmpty(cmd)) {
        setPhase({ s: 'error', message: t('voice.nothingUnderstood'), canType: true });
        return;
      }
      if (missingWho(cmd, members)) {
        if (followUp) setPhase({ s: 'error', message: t('voice.needName'), canType: true });
        else void askWho(cmd, inputs);
        return;
      }
      finish(cmd);
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      playSound('voiceError');
      setPhase({
        s: 'error',
        message: e instanceof VoiceError ? e.message : t('voice.wentWrong'),
        canType: true,
        settings: e instanceof VoiceError && e.settings,
      });
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
  };

  /** records once; null = nothing said (or cancelled), errors are shown */
  const record = async (my: number): Promise<VoiceInput | null> => {
    setLevel(0);
    try {
      const r = await startRecording(setLevel);
      rec.current = r;
      const blob = await r.done;
      if (rec.current !== r || step.current !== my) return null; // cancelled
      rec.current = null;
      return blob ? { kind: 'audio', ...(await toModelAudio(blob)) } : null;
    } catch (e) {
      if (step.current === my) setPhase({ s: 'error', message: e instanceof MicError ? e.message : t('voice.micFailed'), canType: true });
      return null;
    }
  };

  const listen = async () => {
    stopSpeaking();
    const my = ++step.current;
    if (!micSupported()) {
      setPhase({ s: 'typing' });
      return;
    }
    setPhase({ s: 'listening' });
    playSound('voiceStart');
    const input = await record(my);
    if (step.current !== my) return;
    if (!input) {
      setPhase((p) => (p.s === 'listening' ? { s: 'error', message: t('voice.nothingHeard'), canType: true } : p));
      return;
    }
    await run([input]);
  };

  /** "Für wen?": ask (aloud if wanted), then listen for the answer – a tapped name works as well */
  const askWho = async (cmd: Command, inputs: VoiceInput[]) => {
    const my = ++step.current;
    setPhase({ s: 'who', cmd, inputs, listening: false });
    if (voice.speak) await speakAloud(t('voice.whoQuestion'));
    // typed requests get the buttons only
    if (step.current !== my || inputs[0]?.kind !== 'audio' || !micSupported()) return;
    setPhase({ s: 'who', cmd, inputs, listening: true });
    const answer = await record(my);
    if (step.current !== my) return;
    if (!answer) {
      setPhase({ s: 'who', cmd, inputs, listening: false });
      return;
    }
    await run([...inputs, { kind: 'text', text: t('voice.followUpNote') }, answer], true);
  };

  /** a name tapped on the "Für wen?" card */
  const pick = (cmd: Command, names: string[]) => {
    step.current++;
    rec.current?.cancel();
    rec.current = null;
    stopSpeaking();
    finish(fillWho(cmd, members, names));
  };

  const onFab = () => {
    if (phase.s === 'listening' || (phase.s === 'who' && phase.listening)) rec.current?.stop();
    else if (phase.s === 'thinking') return;
    else void listen();
  };

  if (!voice.apiKey) return null;

  const fabListening = phase.s === 'listening' || (phase.s === 'who' && phase.listening);

  return (
    <>
      {phase.s !== 'idle' && (
        <div
          className="voice-card"
          role="dialog"
          aria-label={t('voice.title')}
          aria-live="polite"
          onPointerDown={() => setTouched((n) => n + 1)}
        >
          <button className="voice-close" onClick={close} aria-label={t('common.close')}>
            ×
          </button>

          {phase.s === 'listening' && (
            <div className="voice-status">
              <strong>{t('voice.listening')}</strong>
              <span className="muted">{t('voice.example')}</span>
              <button
                className="voice-link"
                onClick={() => {
                  step.current++;
                  rec.current?.cancel();
                  rec.current = null;
                  setPhase({ s: 'typing' });
                }}
              >
                {t('voice.rather')}
              </button>
            </div>
          )}

          {phase.s === 'thinking' && (
            <div className="voice-status">
              <span className="voice-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <strong>{t('voice.moment')}</strong>
            </div>
          )}

          {phase.s === 'typing' && (
            <form
              className="voice-type"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed.trim()) void run([{ kind: 'text', text: typed.trim() }]);
              }}
            >
              <input
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t('voice.typePlaceholder')}
                aria-label={t('voice.typeLabel')}
                enterKeyHint="send"
              />
              <button className="btn primary" type="submit" disabled={!typed.trim()}>
                {t('voice.go')}
              </button>
            </form>
          )}

          {phase.s === 'who' && (
            <div className="voice-status">
              {phase.cmd.transcript && <p className="voice-transcript">„{phase.cmd.transcript}“</p>}
              <strong>{t('voice.whoQuestion')}</strong>
              <div className="voice-who">
                {members.map((m) => (
                  <button key={m.id} className="btn" style={{ borderColor: m.color }} onClick={() => pick(phase.cmd, [m.name])}>
                    {m.name}
                  </button>
                ))}
                <button className="btn" onClick={() => pick(phase.cmd, [EVERYONE])}>
                  {t('voice.everyone')}
                </button>
              </div>
              {phase.listening && <span className="muted">{t('voice.whoListening')}</span>}
            </div>
          )}

          {phase.s === 'error' && (
            <div className="voice-status">
              <strong>{phase.message}</strong>
              <div className="voice-actions">
                <button className="btn primary" onClick={() => void listen()}>
                  {t('voice.again')}
                </button>
                {phase.canType && (
                  <button
                    className="btn"
                    onClick={() => {
                      step.current++;
                      setPhase({ s: 'typing' });
                    }}
                  >
                    {t('voice.type')}
                  </button>
                )}
                {phase.settings && (
                  <button
                    className="btn"
                    onClick={() => {
                      close();
                      onSettings();
                    }}
                  >
                    {t('common.settings')}
                  </button>
                )}
              </div>
            </div>
          )}

          {phase.s === 'result' && (
            <div className="voice-result">
              {phase.cmd.transcript && <p className="voice-transcript">„{phase.cmd.transcript}“</p>}
              {phase.applied.lines.map((l, i) => (
                <div key={i} className={`voice-line ${phase.undone ? 'undone' : ''}`}>
                  <span className="voice-line-icon" aria-hidden>
                    {l.icon}
                  </span>
                  <span>{l.text}</span>
                </div>
              ))}
              {phase.cmd.askShopping && <ShoppingAnswer speak={speak} />}
              {phase.cmd.askTodos.map((q, i) => (
                <TodosAnswer key={`t${i}`} req={q} speak={speak} />
              ))}
              {phase.cmd.askTimetable.map((q, i) => (
                <TimetableAnswer key={`s${i}`} req={q} speak={speak} />
              ))}
              {phase.cmd.askWeather.map((w, i) => (
                <WeatherAnswer key={`w${i}`} req={w} speak={speak} />
              ))}
              {phase.cmd.askEvents.map((ev, i) => (
                <EventsAnswer key={`e${i}`} req={ev} speak={speak} />
              ))}
              {phase.cmd.show && phase.shown && (
                <div className="voice-line">
                  <span className="voice-line-icon" aria-hidden>
                    {MODULES.find((m) => m.id === phase.cmd.show!.module)?.icon}
                  </span>
                  <span>{phase.shown}</span>
                </div>
              )}
              {phase.cmd.reply && <p className="voice-reply">{phase.cmd.reply}</p>}
              {isEmpty(phase.cmd) && <p className="voice-reply">{t('voice.notUnderstood')}</p>}
              <div className="voice-actions">
                {phase.applied.undo && !phase.undone && (
                  <button
                    className="btn"
                    onClick={() => {
                      phase.applied.undo!();
                      setPhase({ ...phase, undone: true });
                    }}
                  >
                    {t('dashboard.undo')}
                  </button>
                )}
                {phase.undone && <span className="muted">{t('voice.undone')}</span>}
                <button className="btn primary" onClick={() => void listen()}>
                  {t('voice.more')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        className={`voice-fab ${fabListening ? 'listening' : ''} ${phase.s === 'thinking' ? 'thinking' : ''}`}
        style={{ ['--lvl' as string]: level }}
        onClick={onFab}
        aria-label={fabListening ? t('voice.stop') : t('voice.command')}
        title={t('voice.command')}
      >
        <MicIcon />
      </button>
    </>
  );
}
