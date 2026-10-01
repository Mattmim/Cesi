const FEEDS = [
  "https://cesi-edt.vercel.app/ics/fisa-29-s3e-a5-2026-2027/P1.ics",
  "https://cesi-edt.vercel.app/ics/fisa-29-s3e-a5-2026-2027/P2.ics"
];

function unfoldICS(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

function getProperty(event, name) {
  const re = new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "mi");
  const match = event.match(re);
  return match ? match[1] : "";
}

function isSEC(event) {
  // CESI's feed identifies groups in DESCRIPTION, e.g.
  // "Groupes : MECA et SEC". Some events also identify groups in SUMMARY,
  // e.g. "[MECA · SEC]". We keep anything explicitly mentioning SEC.
  const summary = getProperty(event, "SUMMARY");
  const description = getProperty(event, "DESCRIPTION");
  return /\bSEC\b/i.test(`${summary}\n${description}`);
}

function extractEvents(calendar) {
  const unfolded = unfoldICS(calendar);
  const matches = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g);
  return matches || [];
}

function extractHeader(calendar) {
  const unfolded = unfoldICS(calendar);
  const index = unfolded.indexOf("BEGIN:VEVENT");
  if (index === -1) return unfolded.trim();
  return unfolded.slice(0, index).trimEnd();
}

function replaceOrAddLine(header, property, replacement) {
  const re = new RegExp(`^${property}(?:;[^:]*)?:.*(?:\\r?\\n|$)`, "mi");
  if (re.test(header)) {
    return header.replace(re, `${replacement}\r\n`);
  }
  return `${header}\r\n${replacement}`;
}

function buildCalendar(calendars) {
  const first = calendars[0];
  let header = extractHeader(first);

  header = replaceOrAddLine(
    header,
    "X-WR-CALNAME",
    "X-WR-CALNAME:CESI FISA 29 S3E A5 — SEC"
  );
  header = replaceOrAddLine(
    header,
    "X-WR-CALDESC",
    "X-WR-CALDESC:Calendrier CESI filtré pour le groupe SEC"
  );

  const events = [];
  const seen = new Set();

  for (const calendar of calendars) {
    for (const event of extractEvents(calendar)) {
      if (!isSEC(event)) continue;

      const uid = getProperty(event, "UID");
      const key = uid || event;
      if (seen.has(key)) continue;

      seen.add(key);
      events.push(event);
    }
  }

  return [
    header,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...events,
    "END:VCALENDAR"
  ].join("\r\n") + "\r\n";
}

export async function GET() {
  try {
    const responses = await Promise.all(
      FEEDS.map((url) =>
        fetch(url, {
          cache: "no-store",
          headers: {
            "Accept": "text/calendar,text/plain;q=0.9,*/*;q=0.1"
          }
        })
      )
    );

    for (const response of responses) {
      if (!response.ok) {
        throw new Error(`CESI feed returned HTTP ${response.status}`);
      }
    }

    const calendars = await Promise.all(responses.map((r) => r.text()));
    const ics = buildCalendar(calendars);

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="cesi-fisa-29-s3e-a5-sec.ics"',
        "Cache-Control": "no-store, max-age=0, must-revalidate",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error(error);

    return new Response(
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CESI SEC Proxy//FR\r\n" +
      "CALSCALE:GREGORIAN\r\n" +
      "METHOD:PUBLISH\r\n" +
      "X-WR-CALNAME:CESI SEC — ERREUR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:cesi-sec-feed-error@vercel\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20260101T000001Z\r\n" +
      "SUMMARY:Erreur de récupération du calendrier CESI\r\n" +
      "DESCRIPTION:Le flux CESI source est momentanément indisponible.\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n",
      {
        status: 502,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
