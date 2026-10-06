/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const todayStr = () => ymd(startOfToday());
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));

/* ---------- note parser ---------- */
const MONTH_WORDS = [
  ['jan', 'januar', 'january', 'jänner', 'jaenner'],
  ['feb', 'februar', 'february'],
  ['mar', 'march', 'märz', 'maerz', 'mär'],
  ['apr', 'april'],
  ['may', 'mai'],
  ['jun', 'june', 'juni'],
  ['jul', 'july', 'juli'],
  ['aug', 'august'],
  ['sep', 'sept', 'september'],
  ['oct', 'okt', 'october', 'oktober'],
  ['nov', 'november'],
  ['dec', 'dez', 'december', 'dezember'],
];
const MONTH_IDX = {};
MONTH_WORDS.forEach((ws, i) => ws.forEach(w => { MONTH_IDX[w] = i; }));
const MONTH_RE = Object.keys(MONTH_IDX).sort((a, b) => b.length - a.length).join('|');

const WEEKDAY_IDX = {
  monday: 1, mon: 1, montag: 1, ponedjeljak: 1, mo: 1,
  tuesday: 2, tues: 2, tue: 2, dienstag: 2, utorak: 2, di: 2,
  wednesday: 3, wed: 3, mittwoch: 3, srijeda: 3, srijedu: 3, mi: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, donnerstag: 4, četvrtak: 4, cetvrtak: 4, do: 4,
  friday: 5, fri: 5, freitag: 5, petak: 5, fr: 5,
  saturday: 6, sat: 6, samstag: 6, subota: 6, subotu: 6, sa: 6,
  sunday: 0, sun: 0, sonntag: 0, nedjelja: 0, nedjelju: 0, so: 0,
};
// plural forms mean "every …" (mondays, montags, ponedjeljkom)
const WEEKDAY_PLURAL = {
  mondays: 1, montags: 1, ponedjeljkom: 1, tuesdays: 2, dienstags: 2, utorkom: 2,
  wednesdays: 3, mittwochs: 3, srijedom: 3, thursdays: 4, donnerstags: 4, četvrtkom: 4, cetvrtkom: 4,
  fridays: 5, freitags: 5, petkom: 5, saturdays: 6, samstags: 6, subotom: 6, sundays: 0, sonntags: 0, nedjeljom: 0,
};
const WDP_RE = Object.keys(WEEKDAY_PLURAL).sort((a, b) => b.length - a.length).join('|');
const WD_ALL = { ...WEEKDAY_IDX, ...WEEKDAY_PLURAL };
const WD_ALL_RE = Object.keys(WD_ALL).sort((a, b) => b.length - a.length).join('|');
// short forms that are also ordinary words: only count them after a date preposition
const AMBIGUOUS_WD = new Set(['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so', 'sun', 'sat']);
const WD_RE = Object.keys(WEEKDAY_IDX).sort((a, b) => b.length - a.length).join('|');
const PREP = '(?:by|until|till|due|on|before|am|bis|zum|do|za)';
const NEXT = '(?:next|nächsten|nächster|nächste|naechsten|naechste|sljedeći|sljedeci|idući|iduci)';
const THIS = '(?:this|diesen|dieser|diese|ovaj|ovu)';
const B = '(?<![\\p{L}\\p{N}])';   // word start (unicode-aware)
const E = '(?![\\p{L}\\p{N}])';    // word end

function validDate(y, m, d) { return m >= 0 && m < 12 && d >= 1 && d <= dim(y, m); }
function rollYear(y, m, d, today, explicitYear) {
  if (explicitYear) return ymd(new Date(y, m, d));
  let dt = new Date(y, m, d);
  if (dt < addDays(today, -60)) dt = new Date(y + 1, m, d);
  return ymd(dt);
}
function normYear(y) { y = Number(y); return y < 100 ? 2000 + y : y; }

function scoreCategories(text, categories) {
  const low = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const c of categories) {
    let score = 0;
    const words = [c.name, ...(c.keywords || [])].map(w => String(w).trim().toLowerCase()).filter(Boolean);
    for (const w of words) {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(B + esc + '(?:s|es|en|e|n)?' + E, 'u');
      if (re.test(low)) score += w.includes(' ') ? 2 : 1;
    }
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

function parseNote(raw, categories, fallbackId, todayOverride) {
  const today = todayOverride ? new Date(todayOverride) : startOfToday();
  today.setHours(0, 0, 0, 0);
  let s = ' ' + raw.replace(/\s+/g, ' ') + ' ';
  let due = null, time = null, tagCat = null;

  // take the first match of re; fn returns false to leave the text in place
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    const r = fn(m);
    if (r === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  // #hashtag → category
  const tagRe = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
  let tm;
  while ((tm = tagRe.exec(s))) {
    const t = tm[2].toLowerCase();
    const c = categories.find(c => c.name.toLowerCase() === t || c.id === t) ||
      categories.find(c => c.name.toLowerCase().startsWith(t));
    if (c) {
      tagCat = c;
      s = s.slice(0, tm.index) + tm[1] + s.slice(tm.index + tm[0].length);
      break;
    }
  }

  /* ---- recurrence ---- */
  let repeat = null, days = null, end = null;
  const SEP = '(?:\\s*(?:,|/|&|\\+|and|und|i)\\s*|\\s+)';
  take(new RegExp(B + '(?:every\\s*day|each day|daily|täglich|jeden tag|svaki dan|svakodnevno)' + E, 'iu'), () => { repeat = 'daily'; })
    || take(new RegExp(B + '(?:every\\s+weekday|on\\s+weekdays|weekdays|werktags|wochentags|radnim danima|(?:mon|monday|mo|montag)\\s*(?:-|–|bis|to)\\s*(?:fri|friday|fr|freitag))' + E, 'iu'), () => { repeat = 'weekdays'; })
    || take(new RegExp(B + '(?:every|each|jeden|jeweils|immer|svaki|svake|svakog|svaku)\\s+((?:' + WD_ALL_RE + ')\\.?(?:' + SEP + '(?:' + WD_ALL_RE + ')\\.?)*)' + E, 'iu'), m => {
      const ds = [...m[1].matchAll(new RegExp(B + '(' + WD_ALL_RE + ')' + E, 'giu'))].map(x => WD_ALL[x[1].toLowerCase()]);
      if (!ds.length) return false;
      repeat = 'weekly'; days = [...new Set(ds)];
    })
    || take(new RegExp(B + '((?:' + WDP_RE + ')(?:' + SEP + '(?:' + WDP_RE + '))*)' + E, 'iu'), m => {
      const ds = [...m[1].matchAll(new RegExp(B + '(' + WDP_RE + ')' + E, 'giu'))].map(x => WEEKDAY_PLURAL[x[1].toLowerCase()]);
      repeat = 'weekly'; days = [...new Set(ds)];
    })
    || take(new RegExp(B + '(?:weekly|every week|wöchentlich|woechentlich|jede woche|tjedno|svaki tjedan)' + E, 'iu'), () => { repeat = 'weekly'; });

  /* ---- time ---- */
  const hm = (h, m) => `${pad(h)}:${pad(m || 0)}`;
  const pmGuess = (h, prefix) => (prefix && h >= 1 && h <= 6 ? h + 12 : h);
  // ranges: 10:00-11:30, 10-11:30, 9-11h, 2pm-4pm, von 14 bis 16 uhr
  take(new RegExp(B + '(from\\s+|von\\s+|od\\s+)?([01]?\\d|2[0-3])(?:[:.]([0-5]\\d))?\\s*(am|pm|uhr|h)?\\s*(?:-|–|—|to|bis|do)\\s*([01]?\\d|2[0-4])(?:[:.]([0-5]\\d))?\\s*(am|pm|uhr|h)?' + E, 'iu'), m => {
    const [, pre, h1s, m1s, suf1, h2s, m2s, suf2] = m;
    if (!pre && !m1s && !m2s && !suf1 && !suf2) return false;   // "3-5 pages" is not a time
    const ap = (h, suf, other) => {
      const s2 = (suf || other || '').toLowerCase();
      if (s2 === 'pm' && h < 12) return h + 12;
      if (s2 === 'am' && h === 12) return 0;
      return h;
    };
    const h2 = ap(+h2s, suf2, null);
    let h1 = ap(+h1s, suf1, null);
    if (!suf1 && /pm/i.test(suf2 || '') && h1 < 12 && h1 + 12 <= h2) h1 += 12;   // 2-4pm → 14-16, 11-1pm → 11-13
    let a = h1 * 60 + +(m1s || 0), b = h2 * 60 + +(m2s || 0);
    if (b <= a && h2 < 12 && !suf2) { b += 720; }   // 11-1 → 11:00-13:00
    if (b <= a || b > 1440) return false;
    time = hm(Math.floor(a / 60), a % 60);
    end = b === 1440 ? '24:00' : hm(Math.floor(b / 60), b % 60);
  }) ||
  take(new RegExp(B + '(?:(?:at|um|u|@)\\s*)?([01]?\\d|2[0-3])[:.]([0-5]\\d)\\s*(?:uhr|h)' + E, 'iu'), m => { time = hm(+m[1], +m[2]); })
    || take(new RegExp(B + '(?:(?:at|um|u|@)\\s*)?([01]?\\d|2[0-3]):([0-5]\\d)' + E, 'iu'), m => { time = hm(+m[1], +m[2]); })
    || take(new RegExp(B + '(?:(?:at|um|u|@)\\s*)?(1[0-2]|0?[1-9])(?::([0-5]\\d))?\\s*(am|pm)' + E, 'iu'), m => {
      let h = +m[1] % 12; if (m[3].toLowerCase() === 'pm') h += 12; time = hm(h, +(m[2] || 0));
    })
    || take(new RegExp(B + '(at|um|u|@)\\s*([01]?\\d|2[0-3])\\s*(?:uhr|h)?' + E, 'iu'), m => { time = hm(pmGuess(+m[2], true), 0); })
    || take(new RegExp(B + '([01]?\\d|2[0-3])\\s*(?:uhr|h)' + E, 'iu'), m => { time = hm(+m[1], 0); });

  /* ---- dates ---- */
  const P = `(?:${PREP}\\s+)?`;
  const setRel = n => { due = ymd(addDays(today, n)); };
  const tries = [
    // 2026-10-09
    () => take(new RegExp(B + P + '(\\d{4})-(\\d{1,2})-(\\d{1,2})' + E, 'iu'), m => {
      const y = +m[1], mo = +m[2] - 1, d = +m[3];
      if (!validDate(y, mo, d)) return false; due = ymd(new Date(y, mo, d));
    }),
    // 9.10.2026 / 9.10.26 / 9.10.
    () => take(new RegExp(B + P + '(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2,4})?(?![\\p{N}])', 'iu'), m => {
      const mo = +m[2] - 1, d = +m[1];
      const y = m[3] ? normYear(m[3]) : today.getFullYear();
      if (!validDate(y, mo, d)) return false; due = rollYear(y, mo, d, today, !!m[3]);
    }),
    // "bis 9.10" (no trailing dot, needs a preposition so 3.5 isn't a date)
    () => take(new RegExp(B + PREP + '\\s+(\\d{1,2})\\.(\\d{1,2})' + E, 'iu'), m => {
      const mo = +m[2] - 1, d = +m[1], y = today.getFullYear();
      if (!validDate(y, mo, d)) return false; due = rollYear(y, mo, d, today, false);
    }),
    // 9/10 or 9/10/2026 (day first)
    () => take(new RegExp(B + P + '(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?' + E, 'iu'), m => {
      const mo = +m[2] - 1, d = +m[1];
      const y = m[3] ? normYear(m[3]) : today.getFullYear();
      if (!validDate(y, mo, d)) return false; due = rollYear(y, mo, d, today, !!m[3]);
    }),
    // 9 oct, 9. Oktober, 9th of October 2026
    () => take(new RegExp(B + P + '(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s*(?:of\\s+)?(' + MONTH_RE + ')\\.?(?:\\s+(\\d{4}))?' + E, 'iu'), m => {
      const mo = MONTH_IDX[m[2].toLowerCase()], d = +m[1];
      const y = m[3] ? +m[3] : today.getFullYear();
      if (!validDate(y, mo, d)) return false; due = rollYear(y, mo, d, today, !!m[3]);
    }),
    // oct 9, October 9th 2026
    () => take(new RegExp(B + P + '(' + MONTH_RE + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?' + E, 'iu'), m => {
      const mo = MONTH_IDX[m[1].toLowerCase()], d = +m[2];
      const y = m[3] ? +m[3] : today.getFullYear();
      if (!validDate(y, mo, d)) return false; due = rollYear(y, mo, d, today, !!m[3]);
    }),
    // relative words
    () => take(new RegExp(B + P + '(?:day after tomorrow|übermorgen|uebermorgen|prekosutra)' + E, 'iu'), () => setRel(2)),
    () => take(new RegExp(B + P + '(?:heute (?:morgen|früh|abend|nachmittag)|today|tonight|tdy|heute|danas|večeras|veceras)' + E, 'iu'), () => setRel(0)),
    () => take(new RegExp(B + P + '(?:tomorrow|tmrw|tmr|morgen|sutra)' + E, 'iu'), () => setRel(1)),
    () => take(new RegExp(B + '(?:in|za)\\s+(\\d{1,3}|a|one|einem|einer|zwei|two|three|drei)\\s+(days?|tagen?|dana|weeks?|wochen?|woche|tjedana|tjedna|tjedan|months?|monaten?|monat|mjeseci|mjesec)' + E, 'iu'), m => {
      const words = { a: 1, one: 1, einem: 1, einer: 1, two: 2, zwei: 2, three: 3, drei: 3 };
      const n = words[m[1].toLowerCase()] ?? +m[1];
      const unit = m[2].toLowerCase();
      if (/^(month|monat|mjesec)/.test(unit)) { const d = new Date(today); d.setMonth(d.getMonth() + n); due = ymd(d); }
      else setRel(/^(week|woche|tjed)/.test(unit) ? n * 7 : n);
    }),
    () => take(new RegExp(B + P + '(?:' + NEXT + '\\s+(?:week|woche)|sljedeći tjedan|sljedeci tjedan|idući tjedan|iduci tjedan)' + E, 'iu'), () => {
      due = ymd(addDays(mondayOf(today), 7));
    }),
    () => take(new RegExp(B + P + '(?:(?:this|the|am|dieses|ovaj)\\s+)?(?:weekend|wochenende|vikend)' + E, 'iu'), () => {
      const dow = today.getDay();
      setRel(dow === 6 || dow === 0 ? 0 : 6 - dow);
    }),
    () => take(new RegExp(B + P + '(?:(?:the\\s+)?end of (?:the\\s+)?month|monatsende|ende des monats|kraj mjeseca)' + E, 'iu'), () => {
      due = ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    }),
    () => take(new RegExp(B + P + '(?:(?:the\\s+)?end of (?:the\\s+)?week|ende der woche|kraj tjedna)' + E, 'iu'), () => {
      const fri = addDays(mondayOf(today), 4);
      due = ymd(fri < today ? today : fri);
    }),
    // weekdays: "fri", "next tuesday", "am Freitag"
    () => take(new RegExp(B + '(?:(' + NEXT + '|' + THIS + '|' + PREP + ')\\s+)?(' + WD_RE + ')\\.?' + E, 'iu'), m => {
      const word = m[2].toLowerCase();
      const prefix = (m[1] || '').toLowerCase();
      if (AMBIGUOUS_WD.has(word) && !prefix) return false;
      const target = WEEKDAY_IDX[word];
      let delta = (target - today.getDay() + 7) % 7;
      if (new RegExp('^' + NEXT + '$', 'iu').test(prefix)) {
        if (delta === 0) delta = 7;
        const cand = addDays(today, delta);
        if (mondayOf(cand).getTime() === mondayOf(today).getTime()) delta += 7;
      }
      setRel(delta);
    }),
    // "on the 15th", "am 15."
    () => take(new RegExp(B + '(?:on the|the|am|zum)\\s+(\\d{1,2})(?:st|nd|rd|th|\\.)' + '(?![\\p{L}\\p{N}.])', 'iu'), m => {
      const d = +m[1];
      let y = today.getFullYear(), mo = today.getMonth();
      if (d < today.getDate()) { mo += 1; if (mo > 11) { mo = 0; y += 1; } }
      if (!validDate(y, mo, d)) return false; due = ymd(new Date(y, mo, d));
    }),
  ];
  for (const t of tries) if (t()) break;

  // a bare "10-11" counts as a time range once the note already has a day or a repeat
  if (!time && (due || repeat)) {
    take(new RegExp(B + '([01]?\\d|2[0-3])\\s*(?:-|–|—|to|bis|do)\\s*([01]?\\d|2[0-4])' + E, 'iu'), m => {
      const h1 = +m[1], h2 = +m[2];
      if (h1 < 6 || h2 <= h1) return false;
      time = hm(h1, 0); end = hm(h2, 0);
    });
  }

  // tidy the remaining text into a title
  let title = s.replace(/\s+/g, ' ').trim();
  const dangling = new RegExp('(?:^|\\s)(?:' + PREP.slice(3, -1) + '|at|um|u|for|in|für)\\s*$', 'iu');
  for (let i = 0; i < 3; i++) title = title.replace(dangling, '').trim();
  title = title.replace(/^(?:due|by|on)\s+/i, '').replace(/^[,;:–—-]+|[,;:–—-]+$/g, '').replace(/\s+([,.;!?])/g, '$1').trim();
  if (!title) title = raw.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const scored = tagCat || scoreCategories(raw, categories);
  const cat = scored || categories.find(c => c.id === fallbackId) || categories[0];
  return { title, catId: cat.id, matched: !!scored, tagged: !!tagCat, due, time, end, repeat, days };
}
