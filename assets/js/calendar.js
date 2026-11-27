/**
 * Björn Ranelid – Dynamisk Evenemangskalender (Utan inloggning på hemsidan)
 *
 * Så fungerar det för Björn:
 * Björn lägger bara in evenemang i en dedikerad Google Kalender i sin telefon/dator:
 * - Titel: Plats eller evenemangets namn, t.ex. "Ystads Teater – Filosofisk afton"
 *   (Tips: Lägg till [Slutsålt], [Fri entré] eller [Fåtal platser] i titeln eller beskrivningen för status-bricka)
 * - Plats: Stad / lokal, t.ex. "Sjömansgatan 13, Ystad"
 * - Beskrivning: Kort text om framträdandet. Om en webbadress (https://...) klistras in
 *   i beskrivningen skapas automatiskt knappen "Biljetter / Läs mer"!
 */

window.RANELID_CALENDAR_CONFIG = {
  // Alternativ 1: Google Calendar API v3 (Rekommenderas för direkt JSON-hämtning)
  googleCalendarId: '693ecad573897af7c3ffc6d8a3fa27f23a79dac1369253a997490c2f312c407b@group.calendar.google.com',
  googleApiKey: '',     // Begränsad publik Google Calendar API-nyckel

  // Alternativ 2: Publik iCal-URL (.ics) i realtid från Google Kalender ("Ranelid")
  icalUrl: 'https://ranelid-cal-feed.netlify.app/.netlify/functions/ical?id=693ecad573897af7c3ffc6d8a3fa27f23a79dac1369253a997490c2f312c407b%40group.calendar.google.com',

  // Alternativ 3: Lokal fallback / demodata (används om nätverket ligger nere)
  fallbackJsonUrl: 'assets/data/events.json',

  // Hur många nyligen genomförda evenemang som ska visas som referens under kommande
  maxPastEvents: 3
};

const SWEDISH_MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'
];

const SWEDISH_WEEKDAYS = [
  'Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'
];

/**
 * Extraherar status-taggar (t.ex. [Slutsålt], [Fri entré], [Fåtal platser]) och biljettlänk (https://...)
 * från titel och beskrivning.
 */
function parseEventMetadata(rawTitle = '', rawDescription = '') {
  let cleanTitle = rawTitle;
  // Städa eventuell HTML om beskrivningen kommer från Google Kalender
  let cleanDesc = rawDescription
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>.*?<\/a>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();

  const tags = [];
  const bracketRegex = /\[([^\]]+)\]/g;

  cleanTitle = cleanTitle.replace(bracketRegex, (_, tag) => {
    tags.push(tag.trim());
    return '';
  }).trim();

  cleanDesc = cleanDesc.replace(bracketRegex, (_, tag) => {
    tags.push(tag.trim());
    return '';
  }).trim();

  // Hitta första URL i beskrivningen för automatisk "Biljetter / Läs mer"-knapp
  let ticketUrl = null;
  const urlRegex = /(https?:\/\/[^\s<>"]+)/i;
  const urlMatch = cleanDesc.match(urlRegex);
  if (urlMatch) {
    ticketUrl = urlMatch[1].replace(/[.,;)]+$/, '');
    cleanDesc = cleanDesc.replace(urlMatch[0], '').trim();
  }

  // Kontrollera om slutsålt nämns som tagg
  const isSoldOut = tags.some(t => /slutsålt|utsålt|fullbokat/i.test(t));
  const isFree = tags.some(t => /fri entré|gratis/i.test(t));

  return {
    title: cleanTitle,
    description: cleanDesc,
    tags,
    ticketUrl,
    isSoldOut,
    isFree
  };
}

/**
 * Skapar "Lägg till i min kalender"-länk (Google Calendar template URL)
 */
function buildAddToGoogleCalendarUrl(event) {
  const toUtcStamp = (dateStr) => {
    const d = new Date(dateStr);
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };
  const startStamp = toUtcStamp(event.start);
  const endStamp = event.end
    ? toUtcStamp(event.end)
    : toUtcStamp(new Date(new Date(event.start).getTime() + 2 * 60 * 60 * 1000));

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Björn Ranelid – ${event.parsed.title}`,
    dates: `${startStamp}/${endStamp}`,
    details: event.parsed.description + (event.parsed.ticketUrl ? `\n\nBiljetter/info: ${event.parsed.ticketUrl}` : ''),
    location: event.location || ''
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Enkel iCal (.ics) parser om man väljer att koppla kalendern via iCal-länk
 */
function parseIcsFeed(icsText) {
  const events = [];
  const blocks = icsText.split('BEGIN:VEVENT').slice(1);
  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0];
    // Unfold lines
    const unfolded = body.replace(/\r?\n[ \t]/g, '');
    const lines = unfolded.split(/\r?\n/);
    const item = {};
    for (const line of lines) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const keyPart = line.slice(0, idx).split(';')[0].toUpperCase();
      const val = line.slice(idx + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',');
      item[keyPart] = val;
    }
    if (item.DTSTART && item.SUMMARY) {
      const parseIcsDate = (str) => {
        const clean = str.trim();
        if (/^\d{8}$/.test(clean)) {
          return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T18:00:00`;
        }
        const m = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
        if (m) {
          return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}`;
        }
        return clean;
      };
      events.push({
        id: item.UID || Math.random().toString(36).slice(2),
        title: item.SUMMARY || '',
        start: parseIcsDate(item.DTSTART),
        end: item.DTEND ? parseIcsDate(item.DTEND) : null,
        location: item.LOCATION || '',
        description: item.DESCRIPTION || ''
      });
    }
  }
  return events;
}

/**
 * Hämtar evenemang från Google Calendar API, iCal eller lokal JSON-fallback
 */
async function fetchCalendarEvents() {
  const cfg = window.RANELID_CALENDAR_CONFIG;

  // 1. Google Calendar JSON API v3
  if (cfg.googleCalendarId && cfg.googleApiKey) {
    try {
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.googleCalendarId)}/events?key=${encodeURIComponent(cfg.googleApiKey)}&timeMin=${encodeURIComponent(sixtyDaysAgo)}&singleEvents=true&orderBy=startTime&maxResults=50`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return (data.items || []).map(item => ({
          id: item.id,
          title: item.summary || 'Framträdande med Björn Ranelid',
          start: item.start.dateTime || `${item.start.date}T18:00:00`,
          end: item.end ? (item.end.dateTime || `${item.end.date}T20:00:00`) : null,
          location: item.location || '',
          description: item.description || ''
        }));
      }
    } catch (err) {
      console.warn('Kunde inte hämta från Google Calendar API, använder fallback:', err);
    }
  }

  // 2. iCal (.ics) flöde (med cache-busting så nya händelser syns direkt vid omladdning)
  if (cfg.icalUrl) {
    try {
      const sep = cfg.icalUrl.includes('?') ? '&' : '?';
      const res = await fetch(`${cfg.icalUrl}${sep}_t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const text = await res.text();
        return parseIcsFeed(text);
      }
    } catch (err) {
      console.warn('Kunde inte hämta iCal-flöde, använder fallback:', err);
    }
  }

  // 3. Fallback JSON
  const res = await fetch(cfg.fallbackJsonUrl);
  const data = await res.json();
  return data.events || [];
}

function formatEventTime(dateStr) {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const month = SWEDISH_MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  const weekday = SWEDISH_WEEKDAYS[d.getDay()];
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return { day, month, year, weekday, time: `${hours}:${mins}`, dateObj: d };
}

function renderUpcomingEventRow(evt) {
  const dt = formatEventTime(evt.start);
  const p = evt.parsed;
  const gcalUrl = buildAddToGoogleCalendarUrl(evt);

  // Render tags (t.ex. [Slutsålt], [Fri entré], [Fåtal platser])
  const tagBadges = p.tags.map(tag => {
    if (/slutsålt|utsålt/i.test(tag)) {
      return `<span class="px-2.5 py-0.5 rounded-full bg-deep-bordeaux/10 text-deep-bordeaux border border-deep-bordeaux/25 font-label-uppercase text-[10px] uppercase font-bold tracking-wider">${tag}</span>`;
    }
    if (/fri entré|gratis/i.test(tag)) {
      return `<span class="px-2.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-uppercase text-[10px] uppercase font-bold tracking-wider">${tag}</span>`;
    }
    return `<span class="px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-uppercase text-[10px] uppercase font-bold tracking-wider">${tag}</span>`;
  }).join('');

  // Primär åtgärdsknapp (Biljetter / Slutsålt / Fri entré / Boka info)
  let actionHtml = '';
  if (p.isSoldOut) {
    actionHtml = `<span class="inline-flex items-center justify-center px-3.5 py-2 bg-surface-container-high text-on-surface-variant font-label-uppercase text-[11px] uppercase rounded-md sm:rounded-lg font-bold cursor-default select-none whitespace-nowrap">Slutsålt</span>`;
  } else if (p.ticketUrl) {
    actionHtml = `
      <a href="${p.ticketUrl}" target="_blank" rel="noopener noreferrer"
         class="inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-4 py-2 bg-primary text-on-primary font-label-uppercase text-[11px] uppercase rounded-md sm:rounded-lg font-bold hover:bg-deep-bordeaux transition-all shadow-sm whitespace-nowrap">
        <span>Biljetter / Läs mer</span>
        <span class="material-symbols-outlined text-[15px]">open_in_new</span>
      </a>`;
  } else if (p.isFree) {
    actionHtml = `<span class="inline-flex items-center justify-center px-3.5 py-2 bg-tertiary-fixed text-on-tertiary-fixed font-label-uppercase text-[11px] uppercase rounded-md sm:rounded-lg font-bold whitespace-nowrap">Fri entré</span>`;
  }

  return `
    <article class="p-4 sm:p-space-md rounded-xl sm:rounded-lg bg-surface-container-lowest border border-parchment-border/80 hover:border-primary/40 shadow-[0_6px_20px_-6px_rgba(46,28,20,0.06)] hover:shadow-[0_12px_28px_-8px_rgba(46,28,20,0.12)] transition-all">
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-space-sm">
        <div class="flex flex-col sm:flex-row items-start gap-3 sm:gap-space-sm flex-1 min-w-0">
          <!-- Mobil: Kompakt datum + tid/status på samma översta rad | Desktop: Klassisk datumsköld till vänster -->
          <div class="flex items-center justify-between w-full sm:w-auto gap-2">
            <div class="flex sm:block items-baseline gap-1.5 sm:w-16 shrink-0 bg-vellum-glow border border-parchment-border rounded-lg py-1.5 px-3 sm:py-2 sm:px-1 text-center shadow-inner">
              <span class="font-display-hero text-[22px] sm:text-[26px] font-bold text-primary sm:block leading-none">${dt.day}</span>
              <span class="font-label-uppercase text-[11px] text-burnt-umber uppercase font-bold sm:block sm:mt-1">${dt.month}</span>
              <span class="font-metadata text-[11px] sm:text-[10px] text-on-surface-variant sm:block">${dt.year}</span>
            </div>
            <div class="flex sm:hidden flex-wrap items-center justify-end gap-1.5">
              <span class="font-metadata text-[12px] text-secondary font-semibold flex items-center gap-1 whitespace-nowrap">
                <span class="material-symbols-outlined text-[14px]">schedule</span>
                ${dt.weekday} ${dt.time}
              </span>
              ${tagBadges}
            </div>
          </div>

          <!-- Textinnehåll (får 100% bredd på mobil så titeln och beskrivningen inte trycks ihop) -->
          <div class="space-y-1.5 w-full min-w-0">
            <div class="hidden sm:flex flex-wrap items-center gap-2">
              <span class="font-metadata text-[12px] text-secondary font-semibold flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px]">schedule</span>
                ${dt.weekday} kl. ${dt.time}
              </span>
              ${tagBadges}
            </div>
            <h3 class="font-headline-sm text-[18px] sm:text-[20px] text-burnt-umber font-bold leading-snug">${p.title}</h3>
            ${evt.location ? `
              <p class="font-metadata text-[13px] text-on-surface-variant flex items-center gap-1">
                <span class="material-symbols-outlined text-[16px] text-primary shrink-0">location_on</span>
                <span class="truncate">${evt.location}</span>
              </p>
            ` : ''}
            ${p.description ? `
              <p class="font-body-sm text-[13.5px] sm:text-body-sm text-on-surface-variant pt-0.5 leading-relaxed">${p.description}</p>
            ` : ''}
          </div>
        </div>

        <!-- Knappar: Biljetter + Spara i kalender (alltid på en rad utan radbrytning i knappen) -->
        <div class="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 pt-3 sm:pt-0 mt-1 sm:mt-0 shrink-0 border-t sm:border-t-0 border-parchment-border/60">
          ${actionHtml}
          <a href="${gcalUrl}" target="_blank" rel="noopener noreferrer"
             title="Spara i din egen kalender"
             class="inline-flex items-center gap-1 text-metadata text-[12px] text-on-surface-variant hover:text-primary transition-colors py-1 whitespace-nowrap">
            <span class="material-symbols-outlined text-[16px] text-primary sm:text-current">event_available</span>
            <span class="sm:hidden">Spara i kalender</span>
            <span class="hidden sm:inline">Lägg till i min kalender</span>
          </a>
        </div>
      </div>
    </article>
  `;
}

function renderPastEventRow(evt) {
  const dt = formatEventTime(evt.start);
  const p = evt.parsed;
  return `
    <div class="p-space-sm rounded-lg bg-surface-container-low/80 border border-parchment-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 opacity-85 hover:opacity-100 transition-opacity">
      <div class="flex items-center gap-space-sm">
        <div class="w-12 text-center shrink-0">
          <span class="font-headline-sm text-[18px] font-bold text-on-surface-variant block leading-none">${dt.day}</span>
          <span class="font-label-uppercase text-[10px] text-outline uppercase font-semibold">${dt.month}</span>
        </div>
        <div>
          <h4 class="font-headline-sm text-[15px] text-burnt-umber font-semibold">${p.title}</h4>
          <p class="font-metadata text-[12px] text-on-surface-variant">${evt.location || ''}</p>
        </div>
      </div>
      <span class="self-start sm:self-center px-2.5 py-0.5 bg-surface-container text-on-surface-variant font-label-uppercase text-[10px] uppercase rounded-full">Genomfört</span>
    </div>
  `;
}

async function initRanelidCalendar() {
  const upcomingContainer = document.getElementById('calendar-upcoming-list');
  const pastContainer = document.getElementById('calendar-past-list');
  const pastSection = document.getElementById('calendar-past-section');
  const countBadge = document.getElementById('calendar-count-badge');

  if (!upcomingContainer) return;

  try {
    const rawEvents = await fetchCalendarEvents();
    const now = new Date();

    const enriched = rawEvents.map(e => ({
      ...e,
      parsed: parseEventMetadata(e.title, e.description),
      startTimeMs: new Date(e.start).getTime()
    })).filter(e => !isNaN(e.startTimeMs));

    const upcoming = enriched
      .filter(e => e.startTimeMs >= now.getTime() - 6 * 60 * 60 * 1000)
      .sort((a, b) => a.startTimeMs - b.startTimeMs);

    const past = enriched
      .filter(e => e.startTimeMs < now.getTime() - 6 * 60 * 60 * 1000)
      .sort((a, b) => b.startTimeMs - a.startTimeMs)
      .slice(0, window.RANELID_CALENDAR_CONFIG.maxPastEvents || 3);

    if (countBadge) {
      countBadge.textContent = `${upcoming.length} kommande framträdanden`;
    }

    if (upcoming.length === 0) {
      upcomingContainer.innerHTML = `
        <div class="p-space-md rounded-lg bg-surface-container-lowest border border-parchment-border text-center space-y-2">
          <span class="material-symbols-outlined text-primary text-[32px]">event_note</span>
          <h3 class="font-headline-sm text-headline-sm text-burnt-umber">Nya datum publiceras inom kort</h3>
          <p class="font-body-sm text-body-sm text-on-surface-variant max-w-md mx-auto">
            Planering pågår för kommande säsong. För bokningsförfrågningar gällande föreläsningar, författarsamtal eller vigsel, använd formuläret eller direktkontakten intill.
          </p>
        </div>
      `;
    } else {
      upcomingContainer.innerHTML = upcoming.map(renderUpcomingEventRow).join('');
    }

    if (pastContainer && pastSection) {
      if (past.length > 0) {
        pastSection.classList.remove('hidden');
        pastContainer.innerHTML = past.map(renderPastEventRow).join('');
      } else {
        pastSection.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Fel vid inläsning av kalender:', err);
  }
}

document.addEventListener('DOMContentLoaded', initRanelidCalendar);
