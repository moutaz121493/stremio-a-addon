const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = process.env.PORT || 7000;
const PAGE_SIZE = 100;
const PREFIX = "ia:";
const IA = "https://archive.org";

// Internet Archive collections shown as Stremio catalogs
const CATALOGS = [
  { id: "ia-feature-films", name: "Classic Feature Films", collection: "feature_films" },
  { id: "ia-scifi-horror", name: "Sci-Fi & Horror Classics", collection: "SciFi_Horror" },
  { id: "ia-film-noir", name: "Film Noir", collection: "film_noir" },
];

const manifest = {
  id: "community.publicdomain.cinema",
  version: "1.0.0",
  name: "Public Domain Cinema",
  description: "Thousands of free, legal public-domain movies streamed from the Internet Archive.",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: [PREFIX],
  catalogs: CATALOGS.map((c) => ({
    type: "movie",
    id: c.id,
    name: c.name,
    extra: [{ name: "search" }, { name: "skip" }],
  })),
};

const builder = new addonBuilder(manifest);

// ---------- helpers ----------

// Small in-memory cache so we don't hammer archive.org
const cache = new Map();
async function getJson(url, ttlMs = 6 * 60 * 60 * 1000) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data;

  const res = await fetch(url, {
    headers: { "User-Agent": "PublicDomainCinema-Stremio/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();

  if (cache.size > 500) cache.delete(cache.keys().next().value); // simple eviction
  cache.set(url, { data, expires: Date.now() + ttlMs });
  return data;
}

// IA fields can be strings, arrays, or contain HTML
function clean(value) {
  if (Array.isArray(value)) value = value.join(" ");
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function thumb(identifier) {
  return `${IA}/services/img/${encodeURIComponent(identifier)}`;
}

function searchUrl(collection, search, skip) {
  let q = `collection:(${collection}) AND mediatype:(movies)`;
  if (search) q += ` AND title:(${search.replace(/[()":\\]/g, " ")})`;

  const params = new URLSearchParams({
    q,
    rows: String(PAGE_SIZE),
    page: String(Math.floor(skip / PAGE_SIZE) + 1),
    output: "json",
  });
  ["identifier", "title", "year", "description"].forEach((f) => params.append("fl[]", f));
  params.append("sort[]", "downloads desc");
  return `${IA}/advancedsearch.php?${params}`;
}

// ---------- catalog ----------

builder.defineCatalogHandler(async ({ id, extra = {} }) => {
  const cat = CATALOGS.find((c) => c.id === id);
  if (!cat) return { metas: [] };

  try {
    const data = await getJson(searchUrl(cat.collection, extra.search, Number(extra.skip) || 0));
    const metas = (data.response?.docs || []).map((doc) => ({
      id: PREFIX + doc.identifier,
      type: "movie",
      name: clean(doc.title) || doc.identifier,
      poster: thumb(doc.identifier),
      posterShape: "poster",
      releaseInfo: doc.year ? String(doc.year) : undefined,
      description: clean(doc.description).slice(0, 300),
    }));
    return { metas, cacheMaxAge: 6 * 3600 };
  } catch (err) {
    console.error("catalog error:", err.message);
    return { metas: [] };
  }
});

// ---------- meta ----------

builder.defineMetaHandler(async ({ id }) => {
  const identifier = id.slice(PREFIX.length);
  const data = await getJson(`${IA}/metadata/${encodeURIComponent(identifier)}`, 24 * 3600 * 1000);
  const m = data.metadata || {};

  return {
    meta: {
      id,
      type: "movie",
      name: clean(m.title) || identifier,
      poster: thumb(identifier),
      background: thumb(identifier),
      description: clean(m.description),
      releaseInfo: clean(m.year) || clean(m.date).slice(0, 4) || undefined,
      runtime: clean(m.runtime) || undefined,
      website: `${IA}/details/${identifier}`,
    },
    cacheMaxAge: 24 * 3600,
  };
});

// ---------- streams ----------

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|ogv|avi|mpe?g)$/i;
const WEB_READY = /\.(mp4|m4v|webm)$/i;

builder.defineStreamHandler(async ({ id }) => {
  const identifier = id.slice(PREFIX.length);
  const data = await getJson(`${IA}/metadata/${encodeURIComponent(identifier)}`, 24 * 3600 * 1000);

  const files = (data.files || [])
    .filter((f) => VIDEO_EXT.test(f.name))
    // Prefer browser/TV-friendly MP4, then bigger (= higher quality) files
    .sort((a, b) => {
      const aw = WEB_READY.test(a.name) ? 1 : 0;
      const bw = WEB_READY.test(b.name) ? 1 : 0;
      if (aw !== bw) return bw - aw;
      return Number(b.size || 0) - Number(a.size || 0);
    })
    .slice(0, 5);

  const streams = files.map((f) => {
    const ext = f.name.split(".").pop().toUpperCase();
    const size = f.size ? `${Math.round(Number(f.size) / 1048576)} MB` : "";
    const path = f.name.split("/").map(encodeURIComponent).join("/");
    return {
      name: "Internet Archive",
      description: [f.format || ext, size].filter(Boolean).join(" • "),
      url: `${IA}/download/${encodeURIComponent(identifier)}/${path}`,
      behaviorHints: { notWebReady: !WEB_READY.test(f.name) },
    };
  });

  return { streams, cacheMaxAge: 24 * 3600 };
});

serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Public Domain Cinema running on port ${PORT}`);
