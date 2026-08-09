(function () {
  "use strict";

  const feed = document.getElementById("jasmin-events");
  if (!feed) return;

  const PRIMARY_WINDOW_DAYS = 28;

  const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long"
  });

  const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit"
  });

  const weekdayFormatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long"
  });

  function formatEventDate(startAt, endAt) {
    if (!startAt) return "Date à confirmer";

    const start = new Date(startAt);
    let label = dateFormatter.format(start);
    const localTime = start.toLocaleTimeString("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit"
    });

    if (localTime !== "00:00") label += ` à ${timeFormatter.format(start)}`;

    if (endAt) {
      const end = new Date(endAt);
      const options = { timeZone: "Europe/Paris" };
      const sameDay = start.toLocaleDateString("fr-FR", options) ===
        end.toLocaleDateString("fr-FR", options);
      label += sameDay
        ? `–${timeFormatter.format(end)}`
        : ` – ${dateFormatter.format(end)}`;
    }

    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function formatEventSchedule(event) {
    if (event.recurrence_frequency !== "weekly" || !event.start_at || !event.recurrence_until) {
      return formatEventDate(event.start_at, event.end_at);
    }

    const start = new Date(event.start_at);
    const weekday = weekdayFormatter.format(start);
    let label = `Tous les ${weekday}s`;
    const localTime = start.toLocaleTimeString("fr-FR", {
      timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit"
    });
    if (localTime !== "00:00") label += ` à ${timeFormatter.format(start)}`;
    if (event.end_at) label += `–${timeFormatter.format(new Date(event.end_at))}`;
    label += ` jusqu’au ${dateFormatter.format(new Date(event.recurrence_until))}`;
    return label;
  }

  function nextOccurrence(event, now = new Date()) {
    if (!event.start_at) return null;
    const first = new Date(event.start_at);
    if (event.recurrence_frequency !== "weekly" || !event.recurrence_until || now <= first) return first;

    const week = 7 * 24 * 60 * 60 * 1_000;
    const duration = event.end_at
      ? Math.max(new Date(event.end_at).valueOf() - first.valueOf(), 0)
      : 24 * 60 * 60 * 1_000;
    const completedWeeks = Math.floor((now.valueOf() - first.valueOf()) / week);
    const current = new Date(first.valueOf() + completedWeeks * week);
    const next = now.valueOf() <= current.valueOf() + duration
      ? current
      : new Date(current.valueOf() + week);
    return next <= new Date(event.recurrence_until) ? next : null;
  }

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function openImageLightbox(source, title) {
    let dialog = document.querySelector(".event-lightbox");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "event-lightbox";

      const close = document.createElement("button");
      close.type = "button";
      close.className = "event-lightbox__close";
      close.textContent = "×";
      close.setAttribute("aria-label", "Fermer l’image agrandie");
      close.addEventListener("click", () => dialog.close());

      const enlarged = document.createElement("img");
      enlarged.className = "event-lightbox__image";
      dialog.append(close, enlarged);
      dialog.addEventListener("click", event => {
        if (event.target === dialog) dialog.close();
      });
      document.body.appendChild(dialog);
    }

    const enlarged = dialog.querySelector(".event-lightbox__image");
    enlarged.src = source;
    enlarged.alt = `Affiche agrandie : ${title}`;
    dialog.showModal();
  }

  function createEventCard(event) {
    const article = document.createElement("article");
    article.className = "event-card";
    if (event.featured) article.classList.add("event-card--featured");

    if (event.image_url) {
      const imageButton = document.createElement("button");
      imageButton.type = "button";
      imageButton.className = "event-card__image-button";
      imageButton.setAttribute("aria-label", `Agrandir l’affiche de ${event.title}`);

      const image = document.createElement("img");
      image.className = "event-card__image";
      image.src = event.image_url;
      image.alt = `Affiche : ${event.title}`;
      image.loading = "lazy";
      image.addEventListener("error", () => imageButton.remove(), { once: true });
      imageButton.addEventListener("click", () => openImageLightbox(event.image_url, event.title));
      imageButton.appendChild(image);
      article.appendChild(imageButton);
    }

    const content = document.createElement("div");
    content.className = "event-card__content";

    const categoryName = event.categories && event.categories.name;
    if (categoryName) {
      content.appendChild(createTextElement("p", "event-card__category", categoryName));
    }

    content.appendChild(createTextElement("h2", "event-card__title", event.title));

    const details = document.createElement("p");
    details.className = "event-card__details";
    const date = document.createElement("time");
    const nextDate = nextOccurrence(event);
    date.dateTime = nextDate?.toISOString() || event.start_at || "";
    date.textContent = formatEventSchedule(event);
    details.appendChild(date);
    if (event.location_name) details.append(" · ", event.location_name);
    content.appendChild(details);

    if (event.description) {
      content.appendChild(createTextElement("p", "event-card__description", event.description));
    }

    if (event.source_url) {
      const link = document.createElement("a");
      link.className = "event-card__link";
      link.href = event.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Voir les détails";
      link.setAttribute("aria-label", `Voir les détails de ${event.title}`);
      content.appendChild(link);
    }

    article.appendChild(content);
    return article;
  }

  function showMessage(message, isError) {
    feed.replaceChildren(createTextElement(
      "p",
      isError ? "feed-message feed-message--error" : "feed-message",
      message
    ));
  }

  function isInPrimaryWindow(event) {
    if (event.featured || !event.start_at) return true;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + PRIMARY_WINDOW_DAYS);
    cutoff.setHours(23, 59, 59, 999);
    const next = nextOccurrence(event);
    return next !== null && next <= cutoff;
  }

  function createLaterEvents(events) {
    const section = document.createElement("details");
    section.className = "later-events";

    const summary = document.createElement("summary");
    summary.className = "later-events__summary";
    summary.textContent = `Voir les événements à venir plus tard (${events.length})`;
    section.appendChild(summary);

    const grid = document.createElement("div");
    grid.className = "later-events__grid";
    grid.append(...events.map(createEventCard));
    section.appendChild(grid);
    return section;
  }

  async function loadEvents() {
    try {
      const fields = [
        "title", "description", "start_at", "end_at", "location_name",
        "source_url", "image_url", "featured", "recurrence_frequency",
        "recurrence_until", "categories(name,slug)"
      ].join(",");
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/events?select=${fields}&order=featured.desc,start_at.asc`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );

      if (!response.ok) throw new Error(`Supabase returned ${response.status}`);
      const events = await response.json();

      events.sort((left, right) => {
        if (left.featured !== right.featured) return left.featured ? -1 : 1;
        const leftDate = nextOccurrence(left)?.valueOf() ?? Number.MAX_SAFE_INTEGER;
        const rightDate = nextOccurrence(right)?.valueOf() ?? Number.MAX_SAFE_INTEGER;
        return leftDate - rightDate;
      });

      if (!events.length) {
        showMessage("Aucun événement n’est publié pour le moment.", false);
        return;
      }

      const primaryEvents = events.filter(isInPrimaryWindow);
      const laterEvents = events.filter(event => !isInPrimaryWindow(event));
      const content = primaryEvents.map(createEventCard);

      if (!primaryEvents.length) {
        content.push(createTextElement(
          "p",
          "feed-message",
          `Aucun événement n’est publié dans les ${PRIMARY_WINDOW_DAYS} prochains jours.`
        ));
      }
      if (laterEvents.length) content.push(createLaterEvents(laterEvents));
      feed.replaceChildren(...content);
    } catch (error) {
      console.error("Impossible de charger le flux Jasmin Cottage.", error);
      showMessage("Les événements ne peuvent pas être chargés pour le moment.", true);
    }
  }

  loadEvents();
})();
