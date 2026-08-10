(function addToJasminCottage() {
  const editor = "https://npreview-jasmin-cottage-montayral.lodgify.com/fr/gestion-agenda";
  const meta = selector => document.querySelector(selector)?.content?.trim() || "";
  const selection = getSelection()?.toString().trim().slice(0, 3000) || "";
  const anchor = getSelection()?.anchorNode;
  const element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
  const article = element?.closest('[role="article"],article') || document.querySelector('[role="article"],article') || document.body;

  const links = [...article.querySelectorAll("a[href]")].map(link => link.href);
  const postPattern = /\/groups\/[^/]+\/(?:posts|permalink)\/|\/posts\/\d+|permalink\.php|story_fbid=/i;
  const source = postPattern.test(location.href) ? location.href : links.find(link => postPattern.test(link)) || location.href;

  const media = [...new Set(article.querySelectorAll('[data-visualcompletion="media-vc-image"],img[src*="scontent"],img[src]'))];
  const images = media.map(image => ({
    source: image.currentSrc || image.src,
    area: Math.max(image.naturalWidth, image.width) * Math.max(image.naturalHeight, image.height),
    width: Math.max(image.naturalWidth, image.width),
    height: Math.max(image.naturalHeight, image.height),
    preferred: image.matches('[data-visualcompletion="media-vc-image"],img[src*="scontent"]')
  })).filter(image => /^https?:/i.test(image.source) && image.width >= 120 && image.height >= 120)
    .sort((left, right) => (Number(right.preferred) - Number(left.preferred)) || (right.area - left.area));
  const backgrounds = [...article.querySelectorAll('[style*="background-image"]')]
    .map(node => getComputedStyle(node).backgroundImage.match(/url\(["']?(https?:[^"')]+)/i)?.[1]).filter(Boolean);

  const normalized = selection.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const months = { janvier:0, fevrier:1, mars:2, avril:3, mai:4, juin:5, juillet:6, aout:7, septembre:8, octobre:9, novembre:10, decembre:11 };
  const dateMatch = normalized.match(/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?/i);
  const timeMatch = normalized.match(/(?:\ba\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{0,2})/i);
  let start = "";
  if (dateMatch) {
    const now = new Date();
    const year = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
    const date = new Date(year, months[dateMatch[2]], Number(dateMatch[1]), timeMatch ? Number(timeMatch[1]) : 0, timeMatch && timeMatch[2] ? Number(timeMatch[2]) : 0);
    if (!dateMatch[3] && date < new Date(now.valueOf() - 14 * 86400000)) date.setFullYear(year + 1);
    start = date.toISOString();
  }

  const selectedTitle = selection.split(/\r?\n/).map(line => line.trim()).find(Boolean) || "";
  const params = new URLSearchParams({
    capture: "1",
    source_url: source,
    title: (selectedTitle || meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || document.title).slice(0, 200),
    description: (selection || meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]')).slice(0, 3000),
    image_url: images[0]?.source || backgrounds[0] || meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'),
    start_at: start
  });
  open(editor + "#" + params, "jasmin-capture", "popup=yes,width=760,height=900,resizable=yes,scrollbars=yes");
})();
