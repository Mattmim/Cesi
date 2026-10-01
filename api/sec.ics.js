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
  const summary = getProperty(event, "SUMMARY");
  const description = getProperty(event, "DESCRIPTION");

  return /\bSEC\b/i.test(`${summary}\n${description}`);
}

function extractEvents(calendar) {
  const unfolded = unfoldICS(calendar);
  return unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
}

function extractHeader(calendar) {
  const unfolded = unfoldICS(calendar);
  const index = unfolded.indexOf("BEGIN:VEVENT");

  if (index === -1) {
    throw new Error("Invalid source ICS: no VEVENT found");
  }

  return unfolded.slice(0, index).trimEnd();
}

function replaceOrAddLine(header, property, replacement) {
  const re = new RegExp(
    `^${property}(?:;[^:]*)?:.*(?:\\r?\\n|$)`,
    "mi"
  );

  if (re.test(header)) {
    return header.replace(re, `${replacement}\r\n`);
  }

  return `${header}\r\n${replacement}`;
}

function buildCalendar(calendars) {
  let header = extractHeader(calendars[0]);

  header = replaceOrAddLine(
    header,
    "VERSION",
    "VERSION:2.0"
  );

  header = replaceOrAddLine(
    header,
    "PRODID",
    "PRODID:-//CESI SEC Calendar//FR"
  );

  header = replaceOrAddLine(
    header,
    "CALSCALE",
    "CALSCALE:GREGORIAN"
  );

  header = replaceOrAddLine(
    header,
    "METHOD",
    "METHOD:PUBLISH"
  );

  header = replaceOrAddLine(
    header,
    "X-WR-CALNAME",
    "X-WR-CALNAME:CESI FISA 29 S3E A5 - SEC"
  );

  header = replaceOrAddLine(
    header,
    "X-WR-CALDESC",
    "X-WR-CALDESC:Calendrier CESI - groupe SEC"
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

async function fetchCalendar() {
  const responses = await Promise.all(
    FEEDS.map((url) =>
      fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "text/calendar"
        }
      })
    )
  );

  for (const response of responses) {
    if (!response.ok) {
      throw new Error(
        `CESI source returned HTTP ${response.status}`
      );
    }
  }

  return Promise.all(
    responses.map((response) => response.text())
  );
}

function headers() {
  return {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
    "Access-Control-Allow-Origin": "*"
  };
}

/*
 * Apple Calendar peut utiliser HEAD pour vérifier
 * l'existence du calendrier avant de s'abonner.
 *
 * On répond immédiatement sans appeler CESI.
 */
export async function HEAD() {
  return new Response(null, {
    status: 200,
    headers: headers()
  });
}

export async function GET() {
  try {
    const calendars = await fetchCalendar();
    const ics = buildCalendar(calendars);

    if (!ics.startsWith("BEGIN:VCALENDAR\r\n")) {
      throw new Error("Invalid generated ICS");
    }

    if (!ics.endsWith("END:VCALENDAR\r\n")) {
      throw new Error("Invalid generated ICS ending");
    }

    return new Response(ics, {
      status: 200,
      headers: headers()
    });
  } catch (error) {
    console.error("CESI SEC ICS error:", error);

    return new Response(
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//CESI SEC Calendar//FR\r\n" +
      "CALSCALE:GREGORIAN\r\n" +
      "METHOD:PUBLISH\r\n" +
      "END:VCALENDAR\r\n",
      {
        status: 502,
        headers: headers()
      }
    );
  }
}
