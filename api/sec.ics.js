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
    return unfolded.trim();
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
    "X-WR-CALNAME",
    "X-WR-CALNAME:CESI FISA 29 S3E A5 - SEC"
  );

  header = replaceOrAddLine(
    header,
    "X-WR-CALDESC",
    "X-WR-CALDESC:Calendrier CESI filtre pour le groupe SEC"
  );

  header = replaceOrAddLine(
    header,
    "PRODID",
    "PRODID:-//CESI SEC Calendar//FR"
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
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...events,
    "END:VCALENDAR"
  ].join("\r\n") + "\r\n";
}

async function getCalendar() {
  const responses = await Promise.all(
    FEEDS.map((url) =>
      fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1"
        }
      })
    )
  );

  for (const response of responses) {
    if (!response.ok) {
      throw new Error(
        `CESI feed returned HTTP ${response.status}`
      );
    }
  }

  const calendars = await Promise.all(
    responses.map((response) => response.text())
  );

  const ics = buildCalendar(calendars);

  // Vérification minimale avant de transmettre le calendrier
  if (
    !ics.startsWith("BEGIN:VCALENDAR") ||
    !ics.includes("END:VCALENDAR")
  ) {
    throw new Error("Generated ICS is invalid");
  }

  return ics;
}

function calendarHeaders() {
  return {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Content-Disposition": 'inline; filename="cesi-sec.ics"'
  };
}

export async function GET() {
  try {
    const ics = await getCalendar();

    return new Response(ics, {
      status: 200,
      headers: calendarHeaders()
    });
  } catch (error) {
    console.error("CESI SEC calendar error:", error);

    return new Response(
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "CALSCALE:GREGORIAN\r\n" +
      "METHOD:PUBLISH\r\n" +
      "PRODID:-//CESI SEC Calendar//FR\r\n" +
      "X-WR-CALNAME:CESI SEC - ERREUR\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:cesi-sec-feed-error@vercel\r\n" +
      "DTSTAMP:20260101T000000Z\r\n" +
      "DTSTART:20260101T000000Z\r\n" +
      "DTEND:20260101T000001Z\r\n" +
      "SUMMARY:Erreur de recuperation du calendrier CESI\r\n" +
      "DESCRIPTION:Le flux CESI source est momentanement indisponible.\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n",
      {
        status: 502,
        headers: calendarHeaders()
      }
    );
  }
}

export async function HEAD() {
  try {
    await getCalendar();

    return new Response(null, {
      status: 200,
      headers: calendarHeaders()
    });
  } catch (error) {
    console.error("CESI SEC calendar HEAD error:", error);

    return new Response(null, {
      status: 502,
      headers: calendarHeaders()
    });
  }
}
