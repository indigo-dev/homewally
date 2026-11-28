import { CATEGORIES, type CategoryId } from '../lib/shopping';
import { RECURRENCES, type Recurrence } from '../lib/localEvents';
import { MODULES, type ModuleId } from '../components/ModuleNav';
import { isRecord } from '../lib/persisted';
import { getLanguage, type Language } from '../i18n';
import type { ViewMode } from '../types';

/*
 * What the model returns for one spoken request – independent of the provider. The speech part
 * (audio → this structure) can be swapped without touching the rest.
 *
 * Three kinds of request, kept apart on purpose:
 *  - change: put on / check off the shopping list and the to-dos
 *  - ask:    questions; the answer is shown on the card and read aloud, the screen behind stays
 *  - show:   switch the screen (section, people, calendar view and date) – nothing is read aloud
 */

/** stands for the whole family in a list of names ("alle", "wir", "uns") */
export const EVERYONE = '*';

export interface ShopRequest {
  name: string;
  qty: number;
  /** only for items that are not in the pantry yet */
  category?: CategoryId;
}

export interface TodoRequest {
  text: string;
  /** names as spoken, or EVERYONE; empty = nobody named → the app asks "für wen?" */
  members: string[];
  /** YYYY-MM-DD */
  due?: string;
}

/** "Müll rausbringen ist erledigt" */
export interface CheckTodoRequest {
  text: string;
  members: string[];
}

/** "Trag Dienstag um 15 Uhr Fußball für Jan ein" */
export interface AddEventRequest {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** inclusive YYYY-MM-DD for multi-day all-day events */
  endDate?: string;
  allDay: boolean;
  /** HH:MM when allDay is false */
  startTime?: string;
  /** HH:MM when allDay is false */
  endTime?: string;
  repeat: Recurrence;
  /** names as spoken, or EVERYONE; empty = nobody named → the app asks "für wen?" */
  members: string[];
  location?: string;
}

/** "Lösch den Termin Fußball am Dienstag" */
export interface DeleteEventRequest {
  title: string;
  /** optional YYYY-MM-DD */
  date?: string;
  members: string[];
}

/** "Trag Omas Geburtstag am 14. Mai 1956 ein" */
export interface AddBirthdayRequest {
  name: string;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  /** optional 4-digit birth year */
  year?: number;
}

/** "Lösch den Geburtstag von Paul" */
export interface DeleteBirthdayRequest {
  name: string;
}

export interface WeatherRequest {
  /** YYYY-MM-DD */
  date: string;
  /** place name as spoken; empty = home */
  place?: string;
}

export interface EventsRequest {
  /** YYYY-MM-DD, both inclusive */
  from: string;
  to: string;
  /** empty = the whole family */
  members: string[];
}

/** "Welche Aufgaben hat Jan?" */
export interface TodosQuestion {
  /** names or EVERYONE; empty → the app asks */
  members: string[];
}

/** "Was hat Jan morgen?" */
export interface TimetableQuestion {
  /** YYYY-MM-DD */
  date: string;
  /** names or EVERYONE; empty → the app asks */
  members: string[];
}

export interface ShowRequest {
  module: ModuleId;
  /** person filter; empty = leave it as it is */
  members: string[];
  /** calendar only */
  view?: ViewMode;
  /** calendar only: a day inside the period to show, YYYY-MM-DD */
  date?: string;
}

export interface Command {
  /** what was understood, shown to the user */
  transcript: string;
  addShopping: ShopRequest[];
  /** item names that were bought */
  checkShopping: string[];
  addTodos: TodoRequest[];
  checkTodos: CheckTodoRequest[];
  addEvents: AddEventRequest[];
  deleteEvents: DeleteEventRequest[];
  addBirthdays: AddBirthdayRequest[];
  deleteBirthdays: DeleteBirthdayRequest[];
  askWeather: WeatherRequest[];
  askEvents: EventsRequest[];
  askShopping: boolean;
  askTodos: TodosQuestion[];
  askTimetable: TimetableQuestion[];
  show?: ShowRequest;
  /** short message when nothing else fits */
  reply?: string;
}

/** What the model needs to know about the app to map a request. */
export interface VoiceContext {
  now: Date;
  members: string[];
  places: string[];
  pantry: string[];
  /** texts of the open to-dos (to check one off by name) */
  todos?: string[];
  /** titles/dates of local family calendar events (to delete one by name) */
  localEvents?: string[];
  /** whether the local family calendar is enabled */
  localCalendarEnabled?: boolean;
  /** stored birthdays (to delete one by name) */
  birthdays?: string[];
  /** whether the birthdays calendar is enabled */
  birthdaysCalendarEnabled?: boolean;
}

const CAT_IDS = CATEGORIES.map((c) => c.id);
const MODULE_IDS = MODULES.map((m) => m.id);
export const VIEW_IDS: ViewMode[] = ['day', 'days', 'week', 'month', 'year', 'agenda'];

const NAMES = { type: 'ARRAY', items: { type: 'STRING' } } as const;
const DATE = { type: 'STRING', description: 'YYYY-MM-DD' } as const;
const TIME = { type: 'STRING', description: 'HH:MM' } as const;

/** Response schema in the OpenAPI subset Gemini understands. */
export const COMMAND_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING', description: 'Verbatim transcript of what was said' },
    addShopping: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, qty: { type: 'INTEGER' }, category: { type: 'STRING', enum: CAT_IDS } },
        required: ['name', 'qty'],
      },
    },
    checkShopping: { type: 'ARRAY', items: { type: 'STRING' } },
    addTodos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { text: { type: 'STRING' }, members: NAMES, due: DATE },
        required: ['text'],
      },
    },
    checkTodos: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, members: NAMES }, required: ['text'] },
    },
    addEvents: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          date: DATE,
          endDate: DATE,
          allDay: { type: 'BOOLEAN' },
          startTime: TIME,
          endTime: TIME,
          repeat: { type: 'STRING', enum: [...RECURRENCES] },
          members: NAMES,
          location: { type: 'STRING' },
        },
        required: ['title', 'date'],
      },
    },
    deleteEvents: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, date: DATE, members: NAMES },
        required: ['title'],
      },
    },
    addBirthdays: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          day: { type: 'INTEGER' },
          month: { type: 'INTEGER' },
          year: { type: 'INTEGER' },
        },
        required: ['name', 'day', 'month'],
      },
    },
    deleteBirthdays: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' } },
        required: ['name'],
      },
    },
    askWeather: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { date: DATE, place: { type: 'STRING' } }, required: ['date'] },
    },
    askEvents: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { from: DATE, to: DATE, members: NAMES }, required: ['from', 'to'] },
    },
    askShopping: { type: 'BOOLEAN' },
    askTodos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { members: NAMES } } },
    askTimetable: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { date: DATE, members: NAMES }, required: ['date'] },
    },
    show: {
      type: 'OBJECT',
      properties: {
        module: { type: 'STRING', enum: [...MODULE_IDS, 'none'] },
        members: NAMES,
        view: { type: 'STRING', enum: VIEW_IDS },
        date: DATE,
      },
    },
    reply: { type: 'STRING' },
  },
  required: ['transcript'],
} as const;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Instructions for the model. The app language decides the language of the prompt, of the texts the model
 * writes (to-dos, reply) and of the item names it is given; it still understands a request in the other language.
 */
export function buildPrompt(ctx: VoiceContext, lang: Language = getLanguage()): string {
  return lang === 'de' ? germanPrompt(ctx) : englishPrompt(ctx);
}

const list = (xs: string[], none: string) => (xs.length ? xs.join(', ') : none);
const quoted = (xs: string[], none: string) => (xs.length ? xs.map((x) => `"${x}"`).join(', ') : none);

function germanPrompt(ctx: VoiceContext): string {
  const weekday = ctx.now.toLocaleDateString('de-DE', { weekday: 'long' });
  return [
    'Du bist die Sprachsteuerung einer Familien-App (Kalender, Einkaufsliste, To-dos, Wetter, Stundenplan, Fotos, Spiele).',
    'Du bekommst eine kurze deutsche Sprachaufnahme (oder Text) und füllst daraus die Antwort-Struktur.',
    '',
    `Heute ist ${weekday}, der ${ymd(ctx.now)}, ${pad(ctx.now.getHours())}:${pad(ctx.now.getMinutes())} Uhr.`,
    `Familienmitglieder: ${list(ctx.members, 'keine')}.`,
    `Wetter-Orte (der erste ist Zuhause): ${list(ctx.places, 'keine')}.`,
    `Artikel im Vorrat der Einkaufsliste: ${list(ctx.pantry, 'keine')}.`,
    `Offene To-dos: ${quoted(ctx.todos ?? [], 'keine')}.`,
    `Lokale Termine: ${quoted(ctx.localEvents ?? [], 'keine')}.`,
    `Geburtstage: ${quoted(ctx.birthdays ?? [], 'keine')}.`,
    '',
    'Es gibt drei Arten von Bitten – halte sie streng auseinander:',
    '1. ÄNDERN (Einkaufsliste, To-dos, lokaler Familienkalender, Geburtstagskalender)',
    '2. FRAGEN ("was steht …", "welche …", "wie wird …", "lies … vor", "was hat …"): Antwort wird vorgelesen, nichts geöffnet.',
    '3. ZEIGEN ("zeig …", "öffne …", "geh in …", "wechsle zu …"): nur die Anzeige wechseln, nichts vorlesen.',
    'Nur wenn ausdrücklich beides verlangt wird ("zeig mir die Einkaufsliste und lies sie vor"), FRAGEN und ZEIGEN füllen.',
    '',
    'Namen (members): nur Namen aus der Familie, so wie sie oben stehen.',
    `"alle", "wir", "uns", "die ganze Familie" → ["${EVERYONE}"]. "ich", "mich", "mir", "mein" sind KEINE Namen.`,
    'Wurde bei addTodos, addEvents, askTodos oder askTimetable niemand genannt, members leer lassen – die App fragt dann nach.',
    '',
    'Regeln:',
    '- transcript: wörtlich, was gesagt wurde. Bei Stille oder Rauschen leer lassen und sonst nichts füllen.',
    '- addShopping: Dinge auf die Einkaufsliste setzen. Passt ein Artikel aus dem Vorrat, nimm genau dessen Schreibweise',
    '  (auch bei Singular/Plural oder Umgangssprache, z. B. "ne Milch" → "Milch", "Apfel" → "Äpfel").',
    '  qty ist die Anzahl (ohne Angabe 1). Nur für neue Artikel category setzen.',
    '- checkShopping: gekaufte Dinge abhaken ("Milch ist gekauft", "hab die Eier") – Namen wie im Vorrat.',
    '- addTodos: neue Aufgaben und Erinnerungen ("erinnere Jan …", "auf die To-do-Liste"). text kurz und als Aufgabe formuliert.',
    '  due nur bei genanntem Tag.',
    '- checkTodos: erledigte Aufgaben ("Müll rausbringen ist erledigt") – text möglichst genau wie bei den offenen To-dos.',
    '- addEvents: neue Termine im lokalen Familienkalender ("trag Dienstag 15 Uhr Fußball für Jan ein", "jeden Montag Schwimmen").',
    '  allDay true ohne Uhrzeit (endDate bei mehrtägigen Terminen); mit Uhrzeit allDay false, startTime/endTime als HH:MM.',
    '  repeat: none (Standard), weekly, monthly oder yearly.',
    '- deleteEvents: lokale Termine löschen ("lösch den Termin Fußball", "sag Zahnarzt am Freitag ab") – title wie bei den lokalen Terminen.',
    '- addBirthdays: Geburtstage in den eigenen Geburtstagskalender eintragen ("Oma Hilde hat am 14. Mai Geburtstag", "trag Pauls Geburtstag am 3.10.1988 ein").',
    '  Immer ganztägig und keiner Familienperson zugeordnet – NICHT addEvents verwenden! name = Name der Person, day (1–31), month (1–12), optional year (4-stellig).',
    '- deleteBirthdays: Geburtstag aus dem Geburtstagskalender löschen ("lösch den Geburtstag von Paul") – name wie bei den Geburtstagen.',
    '- askWeather: Fragen zum Wetter, ein Eintrag pro Tag. place nur, wenn ein Ort genannt wird.',
    '- askEvents: Fragen zu Terminen ("was steht morgen an?"). Zeiträume als from/to, z. B. "diese Woche" = heute bis Sonntag.',
    '  members nur, wenn nach bestimmten Personen gefragt wird, sonst leer (= ganze Familie).',
    '- askShopping: true bei Fragen nach dem Inhalt der Einkaufsliste ("was steht auf der Einkaufsliste?", "was müssen wir kaufen?").',
    '- askTodos: Fragen nach offenen Aufgaben ("welche Aufgaben hat Lena?").',
    '- askTimetable: Fragen nach Schulstunden ("was hat Jan morgen?", "wann hat Lena heute Schluss?"). date ohne Angabe = heute.',
    '- show: nur bei ZEIGEN, sonst module "none". module ist der Bereich, members der Personenfilter',
    '  ("zeig mir den Stundenplan von Jan" → module "timetable", members ["Jan"]).',
    '  Kalender: view day (Tag), days (mehrere Tage), week (Woche), month (Monat), year (Jahr), agenda (Liste);',
    '  date = ein Tag im gewünschten Zeitraum ("geh zum nächsten Monat" → view "month", date im nächsten Monat).',
    '  Ohne genannte Ansicht oder Datum view/date weglassen.',
    '- Relative Angaben wie "morgen", "übermorgen", "nächsten Dienstag" in Daten (YYYY-MM-DD) umrechnen.',
    '- reply: nur wenn die Bitte nicht zu den Bereichen passt oder unklar ist – ein kurzer, freundlicher Satz.',
    '- Abonnierte externe Kalender können nicht geändert oder gelöscht werden; lokale Termine schon.',
  ].join('\n');
}

function englishPrompt(ctx: VoiceContext): string {
  const weekday = ctx.now.toLocaleDateString('en-GB', { weekday: 'long' });
  return [
    'You are the voice control of a family app (calendar, shopping list, to-dos, weather, timetable, photos, games).',
    'You get a short voice recording (or text), usually in English, and fill in the answer structure from it.',
    'Write all texts you produce (to-do texts, new item names, reply) in English.',
    '',
    `Today is ${weekday}, ${ymd(ctx.now)}, ${pad(ctx.now.getHours())}:${pad(ctx.now.getMinutes())}.`,
    `Family members: ${list(ctx.members, 'none')}.`,
    `Weather places (the first one is home): ${list(ctx.places, 'none')}.`,
    `Items in the shopping list pantry: ${list(ctx.pantry, 'none')}.`,
    `Open to-dos: ${quoted(ctx.todos ?? [], 'none')}.`,
    `Local events: ${quoted(ctx.localEvents ?? [], 'none')}.`,
    `Birthdays: ${quoted(ctx.birthdays ?? [], 'none')}.`,
    '',
    'There are three kinds of request – keep them strictly apart:',
    '1. CHANGE (shopping list, to-dos, local family calendar, birthdays calendar)',
    '2. ASK ("what\'s on …", "which …", "how will …", "read … out", "what does … have"): the answer is read aloud, nothing is opened.',
    '3. SHOW ("show …", "open …", "go to …", "switch to …"): only change the screen, read nothing aloud.',
    'Fill both ASK and SHOW only if both are asked for explicitly ("show me the shopping list and read it out").',
    '',
    'Names (members): only names from the family, spelled as above.',
    `"everyone", "all of us", "we", "us", "the whole family" → ["${EVERYONE}"]. "I", "me", "my" are NOT names.`,
    'If nobody is named for addTodos, addEvents, askTodos or askTimetable, leave members empty – the app will ask.',
    '',
    'Rules:',
    '- transcript: verbatim what was said. On silence or noise leave it empty and fill in nothing else.',
    '- addShopping: things to put on the shopping list. If an item from the pantry fits, use exactly its spelling',
    '  (also for singular/plural or casual speech, e.g. "a milk" → "Milk", "an apple" → "Apples").',
    '  qty is the number (1 if none is said). Set category only for new items.',
    '- checkShopping: things that were bought ("got the milk", "eggs are bought") – names as in the pantry.',
    '- addTodos: new tasks and reminders ("remind Jan …", "put … on the to-do list"). text short and phrased as a task.',
    '  due only if a day is mentioned.',
    '- checkTodos: tasks that are done ("taking out the rubbish is done") – text as close as possible to the open to-dos.',
    '- addEvents: new events in the local family calendar ("add football for Jan on Tuesday at 3pm", "swimming every Monday").',
    '  allDay true without a time (endDate for multi-day events); with a time allDay false, startTime/endTime as HH:MM.',
    '  repeat: none (default), weekly, monthly or yearly.',
    '- deleteEvents: remove local events ("delete the football event", "cancel dentist on Friday") – title close to the local events.',
    '- addBirthdays: add birthdays to the dedicated birthdays calendar ("Grandma\'s birthday is May 14", "add Paul\'s birthday on 3 October 1988").',
    "  Always all-day and not assigned to any family member – do NOT use addEvents! name = person's name, day (1–31), month (1–12), optional 4-digit year.",
    '- deleteBirthdays: remove a birthday ("delete Paul\'s birthday") – name close to the stored birthdays.',
    '- askWeather: questions about the weather, one entry per day. place only if a place is mentioned.',
    '- askEvents: questions about events ("what\'s on tomorrow?"). Periods as from/to, e.g. "this week" = today to Sunday.',
    '  members only if the question is about certain people, otherwise empty (= whole family).',
    '- askShopping: true for questions about what is on the shopping list ("what\'s on the shopping list?", "what do we need?").',
    '- askTodos: questions about open tasks ("which tasks does Lena have?").',
    '- askTimetable: questions about school lessons ("what does Jan have tomorrow?", "when does Lena finish today?"). No date = today.',
    '- show: only for SHOW, otherwise module "none". module is the section, members the person filter',
    '  ("show me Jan\'s timetable" → module "timetable", members ["Jan"]).',
    '  Calendar: view day, days (several days), week, month, year, agenda (list);',
    '  date = a day inside the wanted period ("go to next month" → view "month", date in next month).',
    '  Leave out view/date if none is mentioned.',
    '- Convert relative dates like "tomorrow", "the day after tomorrow", "next Tuesday" into dates (YYYY-MM-DD).',
    '- reply: only if the request does not fit the sections or is unclear – one short, friendly sentence.',
    '- Subscribed external calendars cannot be edited or deleted; local family events can.',
  ].join('\n');
}

/* ------------------------------------------------------------------ validation */

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00`).getTime());
const isHm = (v: string) => {
  if (!/^\d{2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
};
const objs = (v: unknown) => (Array.isArray(v) ? v.filter(isRecord) : []);
const ymdOr = (v: unknown) => (isYmd(str(v)) ? str(v) : undefined);
const hmOr = (v: unknown) => (isHm(str(v)) ? str(v) : undefined);

function parseShow(raw: unknown): ShowRequest | undefined {
  if (!isRecord(raw)) return undefined;
  const module = str(raw.module) as ModuleId;
  if (!MODULE_IDS.includes(module)) return undefined;
  const view = str(raw.view) as ViewMode;
  const calendar = module === 'calendar';
  return {
    module,
    members: strs(raw.members),
    view: calendar && VIEW_IDS.includes(view) ? view : undefined,
    date: calendar ? ymdOr(raw.date) : undefined,
  };
}

/** Turns whatever the model returned into a valid command (drops what does not fit). */
export function parseCommand(raw: unknown): Command {
  const r = isRecord(raw) ? raw : {};
  const addShopping = objs(r.addShopping)
    .map((s): ShopRequest => {
      const qty = typeof s.qty === 'number' && Number.isFinite(s.qty) ? Math.round(s.qty) : 1;
      const cat = str(s.category) as CategoryId;
      return { name: str(s.name), qty: Math.min(Math.max(qty, 1), 99), category: CAT_IDS.includes(cat) ? cat : undefined };
    })
    .filter((s) => s.name);
  const addTodos = objs(r.addTodos)
    .map((t): TodoRequest => ({ text: str(t.text), members: strs(t.members), due: ymdOr(t.due) }))
    .filter((t) => t.text);
  const checkTodos = objs(r.checkTodos)
    .map((t): CheckTodoRequest => ({ text: str(t.text), members: strs(t.members) }))
    .filter((t) => t.text);
  const addEvents = objs(r.addEvents)
    .map((e): AddEventRequest => {
      const date = str(e.date);
      const startTime = hmOr(e.startTime);
      const endTime = hmOr(e.endTime);
      const allDay = typeof e.allDay === 'boolean' ? e.allDay : !startTime;
      const endDate = allDay && ymdOr(e.endDate) && str(e.endDate) > date ? str(e.endDate) : undefined;
      const rep = str(e.repeat) as Recurrence;
      return {
        title: str(e.title),
        date,
        endDate,
        allDay,
        startTime: allDay ? undefined : (startTime ?? '09:00'),
        endTime: allDay ? undefined : endTime,
        repeat: RECURRENCES.includes(rep) ? rep : 'none',
        members: strs(e.members),
        location: str(e.location) || undefined,
      };
    })
    .filter((e) => e.title && isYmd(e.date));
  const deleteEvents = objs(r.deleteEvents)
    .map((e): DeleteEventRequest => ({ title: str(e.title), date: ymdOr(e.date), members: strs(e.members) }))
    .filter((e) => e.title);
  const addBirthdays = objs(r.addBirthdays)
    .map((b): AddBirthdayRequest => {
      const month = typeof b.month === 'number' && Number.isInteger(b.month) ? b.month : 0;
      const day = typeof b.day === 'number' && Number.isInteger(b.day) ? b.day : 0;
      const year = typeof b.year === 'number' && Number.isInteger(b.year) && b.year >= 1900 && b.year <= 2100 ? b.year : undefined;
      return { name: str(b.name), month, day, year };
    })
    .filter((b) => b.name && b.month >= 1 && b.month <= 12 && b.day >= 1 && b.day <= 31);
  const deleteBirthdays = objs(r.deleteBirthdays)
    .map((b): DeleteBirthdayRequest => ({ name: str(b.name) }))
    .filter((b) => b.name);
  const askWeather = objs(r.askWeather)
    .map((w): WeatherRequest => ({ date: str(w.date), place: str(w.place) || undefined }))
    .filter((w) => isYmd(w.date));
  const askEvents = objs(r.askEvents)
    .map((e): EventsRequest => {
      const from = str(e.from);
      const to = isYmd(str(e.to)) ? str(e.to) : from;
      return to < from ? { from: to, to: from, members: strs(e.members) } : { from, to, members: strs(e.members) };
    })
    .filter((e) => isYmd(e.from));
  const askTimetable = objs(r.askTimetable)
    .map((q): TimetableQuestion => ({ date: str(q.date), members: strs(q.members) }))
    .filter((q) => isYmd(q.date));
  return {
    transcript: str(r.transcript),
    addShopping,
    checkShopping: strs(r.checkShopping),
    addTodos,
    checkTodos,
    addEvents,
    deleteEvents,
    addBirthdays,
    deleteBirthdays,
    askWeather,
    askEvents,
    askShopping: r.askShopping === true,
    askTodos: objs(r.askTodos).map((q): TodosQuestion => ({ members: strs(q.members) })),
    askTimetable,
    show: parseShow(r.show),
    reply: str(r.reply) || undefined,
  };
}

/** true if the command asks for nothing at all */
export const isEmpty = (c: Command) =>
  !c.addShopping.length &&
  !c.checkShopping.length &&
  !c.addTodos.length &&
  !c.checkTodos.length &&
  !c.addEvents.length &&
  !c.deleteEvents.length &&
  !c.addBirthdays.length &&
  !c.deleteBirthdays.length &&
  !c.askWeather.length &&
  !c.askEvents.length &&
  !c.askShopping &&
  !c.askTodos.length &&
  !c.askTimetable.length &&
  !c.show &&
  !c.reply;

/** true if it only changes the screen – nothing is said then */
export const isQuiet = (c: Command) => !!c.show && isEmpty({ ...c, show: undefined });
