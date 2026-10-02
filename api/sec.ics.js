const FEEDS = [
  "https://cesi-edt.vercel.app/ics/fisa-29-s3e-a5-2026-2027/P1.ics"
];

const CAL_NAME = "CESI FISA 29 S3E A5 - SEC";

function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

function getProperty(block, name) {
  const m = block.match(new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, "mi"));
  return m ? m[1].trim() : "";
}

const ROOMS = {
  Alpha: [
    "Athéna", "Thésée", "Hélios", "Phoébé", "Orphée", "Prométhée", "Gaïa",
    "Ouranos", "Hespérides Alpha", "Hespérides Omega", "Pléïades 1",
    "Pléïades 2", "Eole", "Poseïdon", "Hemera", "Bering"
  ],
  Omega: [
    "Acapulco", "Carthage", "Bélem", "Honolulu", "Bamako", "La Havane",
    "Louxor", "Persépolis", "Nouméa", "Cadix", "Bonifacio", "Pétra", "Syracuse"
  ],
  "UPS BAT 3A": ["G45-G46"]
};

function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ");
}

// Plus longs d'abord (ex. "Hespérides Alpha" avant "Hespérides")
const ROOM_PATTERNS = Object.entries(ROOMS)
  .flatMap(([building, list]) =>
    list.map((name) => ({ building, name, key: normalize(name) }))
  )
  .concat([{ building: "Alpha", name: "Hespérides", key: "hesperides" }])
  .sort((a, b) => b.key.length - a.key.length)
  .map((r) => ({
    ...r,
    re: new RegExp(`(^|[^a-z0-9])${r.key.replace(/ /g, "\\s*")}(?![a-z0-9])`, "g")
  }));

function findRooms(text) {
  let t = normalize(text);
  const found = [];
  for (const r of ROOM_PATTERNS) {
    if (r.re.test(t)) {
      found.push(`${r.building} - ${r.name}`);
      t = t.replace(r.re, "$1 "); // évite qu'un nom court rematche
    }
    r.re.lastIndex = 0;
  }
  return found;
}

function escapeText(s) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

// Ajoute "Bâtiment - Salle" en LOCATION, notes inchangées
function withLocation(event) {
  const desc = getProperty(event, "DESCRIPTION").replace(/\\n/gi, "\n");
  const salleLine = (desc.match(/^\s*salles?\s*:\s*(.+)$/im) || [])[1] || "";
  const source = salleLine || `${getProperty(event, "LOCATION")}\n${desc}`;
  const found = findRooms(source);
  if (!found.length) return event;

  const loc = `LOCATION:${escapeText(found.join(" / "))}`;
  if (/^LOCATION(?:;[^:\r\n]*)?:/m.test(event)) {
    return event.replace(/^LOCATION(?:;[^:\r\n]*)?:.*$/m, loc);
  }
  return event.replace(/END:VEVENT\s*$/, `${loc}\r\nEND:VEVENT`);
}

// Périodes / missions / semaines en entreprise
function isEntreprise(event) {
  const s = normalize(getProperty(event, "SUMMARY"));
  return (
    /^\s*entreprise\b/.test(s) ||
    /\ben entreprise\b/.test(s) ||
    /\b(periode|mission|semaine|journee|jour)s?\s+(en\s+)?entreprise\b/.test(s)
  );
}

// Garde SEC + cours communs, retire MECA et les périodes entreprise
function keep(event) {
  if (isEntreprise(event)) return false;
  const t = `${getProperty(event, "SUMMARY")}\n${getProperty(event, "DESCRIPTION")}`;
  return /\bSEC\b/i.test(t) || !/\bMECA\b/i.test(t);
}

// Repliage RFC 5545 : 75 octets max par ligne
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "";
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) {
      out.push(cur);
      cur = " ";
      size = 1;
      limit = 75;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

function blockLines(block) {
  return block.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
}

function buildCalendar(sources) {
  let vtimezone = null;
  const events = [];
  const seen = new Set();

  for (const raw of sources) {
    const cal = unfold(raw);
    if (!vtimezone) {
      const tz = cal.match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/);
      if (tz) vtimezone = tz[0];
    }
    for (const ev of cal.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || []) {
      if (!keep(ev)) continue;
      const key = getProperty(ev, "UID") || ev;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(withLocation(ev));
    }
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CESI SEC Calendar//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${CAL_NAME}`,
    "X-WR-TIMEZONE:Europe/Paris",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...(vtimezone ? blockLines(vtimezone) : []),
    ...events.flatMap(blockLines),
    "END:VCALENDAR"
  ];

  return lines.map(fold).join("\r\n") + "\r\n";
}

async function fetchSources() {
  const results = await Promise.allSettled(
    FEEDS.map(async (url) => {
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "text/calendar" } });
      if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
      const text = await r.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error(`${url} -> pas un ICS`);
      return text;
    })
  );
  const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  results
    .filter((r) => r.status === "rejected")
    .forEach((r) => console.error("Source KO:", r.reason));
  if (!ok.length) throw new Error("Aucune source CESI disponible");
  return ok;
}

function headers() {
  return {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": 'inline; filename="cesi-sec.ics"',
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Access-Control-Allow-Origin": "*"
  };
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: headers() });
}

export async function GET() {
  try {
    const ics = buildCalendar(await fetchSources());
    return new Response(ics, { status: 200, headers: headers() });
  } catch (error) {
    console.error("CESI SEC ICS error:", error);
    return new Response(`Erreur : ${error.message}`, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
