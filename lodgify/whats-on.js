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

  function createTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function createEventCard(event) {
    const article = document.createElement("article");
    article.className = "event-card";
    if (event.featured) article.classList.add("event-card--featured");

    if (event.image_url) {
      const image = document.createElement("img");
      image.className = "event-card__image";
      image.src = event.image_url;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove(), { once: true });
      article.appendChild(image);
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
    date.dateTime = event.start_at || "";
    date.textContent = formatEventDate(event.start_at, event.end_at);
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
    return new Date(event.start_at) <= cutoff;
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
        "source_url", "image_url", "featured", "categories(name,slug)"
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
