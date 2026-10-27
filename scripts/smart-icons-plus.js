import {
  MODULE_ID,
  STATE,
  STOP_WORDS,
  GENERIC_FOLDERS,
  SCORING,
  COMPENDIUM_SCORING,
  BROWSE_CONCURRENCY,
} from "./config.js";

const LOG = "Smart Icons Plus |";

// Folders that never contain useful icons (or are huge and slow to crawl).
// Same as the original module, plus a few that matter once the whole Data folder is scanned.
const DEFAULT_IGNORED = [
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.[^/]+(\/|$)/,                       // hidden folders (.git, .github, ...)
  /^(modules|systems)\/[^/]+\/(lang|packs|src|templates)(\/|$)/,
  /^worlds\/[^/]+\/(data|packs)(\/|$)/,        // world databases, no images
];

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

function registerSettings() {
  const reindexOnChange = () => {
    if (game.user?.isGM && game.ready) buildIndex({ notify: true });
  };

  game.settings.register(MODULE_ID, "scanDataFolder", {
    name: "Scan the whole Data folder",
    hint: "Index every image in the server's user Data folder (worlds, uploaded assets, your own folders, all modules). Turn off to only scan core icons, the current system, modules and the extra folders below — like the original Smart Icons.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: reindexOnChange,
  });

  game.settings.register(MODULE_ID, "extraFolders", {
    name: "Extra folders to scan",
    hint: "Comma-separated folders in the Data folder to scan in addition to the defaults (only needed when 'Scan the whole Data folder' is off). Example: assets/icons, worlds/my-world/tokens",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: reindexOnChange,
  });

  game.settings.register(MODULE_ID, "ignoredFolders", {
    name: "Folders to ignore",
    hint: "Comma-separated folder paths to skip. Any folder whose path starts with one of these is ignored. Example: assets/maps, modules/some-huge-map-pack",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: reindexOnChange,
  });

  game.settings.register(MODULE_ID, "matchFolderNames", {
    name: "Also match folder names",
    hint: "Use the names of the folders an image sits in as extra keywords (e.g. 'weapons/axe-01.png' also matches 'weapons'). Generic names like 'assets' or 'images' are ignored.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: reindexOnChange,
  });

  game.settings.register(MODULE_ID, "s3Bucket", {
    name: "S3 bucket (optional)",
    hint: "If your server stores files in an S3 bucket, enter the bucket name to index it too. Leave empty otherwise.",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: reindexOnChange,
  });

  game.settings.register(MODULE_ID, "maxResults", {
    name: "Maximum results shown",
    hint: "How many icons the picker shows at most.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 10, max: 200, step: 10 },
    default: 30,
  });
}

function settingList(key) {
  return game.settings.get(MODULE_ID, key)
    .split(/[,\n]/)
    .map(s => s.trim().replace(/^\/+|\/+$/g, "").toLowerCase())
    .filter(Boolean);
}

/* -------------------------------------------- */
/*  Header buttons & hooks                      */
/* -------------------------------------------- */

function attachHeaderButton(app, buttons) {
  if (!game.user.isGM || !app.document) return;

  const docName = app.document.documentName;
  if (docName !== "Actor" && docName !== "Item") return;

  const activate = () => {
    if (!STATE.ready) {
      ui.notifications.warn("Smart Icons Plus is still indexing images. Please try again in a moment.");
      return;
    }
    if (docName === "Item") openIconPicker(app.document);
    else batchSetIcons(app.document);
  };

  buttons.unshift({
    label: "Smart Icons",
    title: docName === "Item"
      ? "Assign a smart icon to this item"
      : "Batch assign smart icons to all items",
    class: "smart-icons-plus-button",
    icon: "fas fa-images",
    onclick: activate,  // AppV1
    onClick: activate,  // AppV2
  });
}

Hooks.once("init", () => {
  console.log(`${LOG} Initializing...`);
  registerSettings();

  for (const sheetType of ["ActorSheet", "ItemSheet"]) {
    Hooks.on(`get${sheetType}HeaderButtons`, attachHeaderButton);
  }
  Hooks.on("getHeaderControlsApplicationV2", attachHeaderButton);

  // Small API for macros: game.modules.get("smart-icons-plus").api.reindex()
  game.modules.get(MODULE_ID).api = {
    reindex: () => buildIndex({ notify: true }),
    search: (text) => findBestMatchingIcons(keywordsFromName(text, true), null),
    state: STATE,
  };
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  if (game.modules.get("smart-icons")?.active) {
    ui.notifications.warn("Smart Icons Plus: the original Smart Icons module is also active. Disable one of them to avoid two header buttons.");
  }
  // Non-blocking so the world loads normally.
  setTimeout(() => buildIndex(), 0);
});

/* -------------------------------------------- */
/*  Indexing                                    */
/* -------------------------------------------- */

async function buildIndex({ notify = false } = {}) {
  if (STATE.indexing) return STATE.indexing;

  STATE.indexing = (async () => {
    STATE.ready = false;
    const t0 = performance.now();
    if (notify) ui.notifications.info("Smart Icons Plus: rebuilding image index...");
    try {
      await indexFileIcons();
      await indexCompendiumItems();
      STATE.ready = true;
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const msg = `Indexed ${STATE.iconKeywords.size} image files and ${Object.keys(STATE.compendiumKeywords).length} compendium items in ${secs}s.`;
      console.log(`${LOG} ${msg}`);
      if (notify) ui.notifications.info(`Smart Icons Plus: ${msg}`);
    } catch (err) {
      console.error(`${LOG} Indexing failed:`, err);
      ui.notifications.error("Smart Icons Plus: indexing failed. See console (F12) for details.");
    } finally {
      STATE.indexing = null;
    }
  })();
  return STATE.indexing;
}

/**
 * Creates a set of keywords from a file path or item name.
 * @param {string} name     File path or item name.
 * @param {boolean} isItem  Is this an item name instead of a file path?
 * @param {boolean} withFolders  Also use folder names of a file path as keywords.
 */
function keywordsFromName(name, isItem = false, withFolders = false) {
  let parts;
  if (isItem) {
    parts = [name];
  } else {
    let path = name.split("?")[0];
    try { path = decodeURIComponent(path); } catch { /* malformed sequence */ }
    const segments = path.split("/");
    const file = segments.pop().replace(/\.[^.]+$/, "");
    parts = [file];
    if (withFolders) {
      for (const seg of segments) {
        if (!seg || seg.includes(":") || GENERIC_FOLDERS.has(seg.toLowerCase())) continue;
        parts.push(seg);
      }
    }
  }

  const words = new Set();
  for (const part of parts) {
    for (const raw of part.split(/[\s\-_.,()\[\]]+/)) {
      const word = raw.toLowerCase().trim();
      if (word.length >= SCORING.KEYWORD_LENGTH && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) {
        words.add(word);
      }
    }
  }
  return words;
}

/**
 * Crawls folders (in parallel) and indexes every image file found.
 */
async function indexFileIcons() {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  const extensions = new Set(Object.keys(CONST.FILE_CATEGORIES.IMAGE).map(e => e.toLowerCase()));
  const withFolders = game.settings.get(MODULE_ID, "matchFolderNames");
  const scanAll = game.settings.get(MODULE_ID, "scanDataFolder");
  const userIgnored = settingList("ignoredFolders");
  const systemId = game.system.id;
  const otherSystem = new RegExp(`^systems\\/(?!${systemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\/|$))[^/]+`);

  const index = new Map();

  const isIgnored = (path) => {
    let p = path;
    try { p = decodeURIComponent(p); } catch { /* keep raw */ }
    p = p.replace(/^\/+/, "");
    const lower = p.toLowerCase();
    if (otherSystem.test(p)) return true;
    if (DEFAULT_IGNORED.some(rgx => rgx.test(p))) return true;
    return userIgnored.some(ig => lower === ig || lower.startsWith(ig + "/"));
  };

  // Folders to start from: [source, path, options]
  const roots = [["public", "icons", {}]];
  if (scanAll) {
    roots.push(["data", "", {}]);
  } else {
    roots.push(["data", `systems/${systemId}`, {}]);
    roots.push(["data", "modules", {}]);
    for (const extra of settingList("extraFolders")) roots.push(["data", extra, {}]);
  }
  const bucket = game.settings.get(MODULE_ID, "s3Bucket").trim();
  if (bucket) roots.push(["s3", "", { bucket }]);
  if (globalThis.ForgeVTT?.usingTheForge) roots.push(["forgevtt", "", {}]);

  const queue = [...roots];
  const seen = new Set();
  let failed = 0;

  async function worker() {
    while (queue.length) {
      const [source, path, options] = queue.shift();
      const key = `${source}|${options.bucket ?? ""}|${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (path && isIgnored(path)) continue;

      let content;
      try {
        content = await FilePicker.browse(source, path, options);
      } catch {
        failed++;
        continue; // unbrowsable folder
      }

      for (const file of content.files ?? []) {
        const ext = file.split("?")[0].split(".").pop().toLowerCase();
        if (!extensions.has(ext) || index.has(file)) continue;
        const keywords = keywordsFromName(file, false, withFolders);
        if (keywords.size) index.set(file, keywords);
      }
      for (const dir of content.dirs ?? []) {
        queue.push([source, dir, options]);
      }
    }
  }

  // Workers wait for each other: a worker only exits when the queue is empty,
  // but others may still add folders. Loop until nothing is left.
  do {
    await Promise.all(Array.from({ length: BROWSE_CONCURRENCY }, worker));
  } while (queue.length);

  STATE.iconKeywords = index;
  if (failed) console.debug(`${LOG} ${failed} folders could not be browsed and were skipped.`);
}

/**
 * Indexes all items from compendium packs (unchanged from original).
 */
async function indexCompendiumItems() {
  STATE.compendiumKeywords = {};
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    const index = await pack.getIndex({ fields: ["img"] });
    for (const entry of index) {
      if (!entry.img || entry.img.includes("mystery-man") || /\/default-icons\//.test(entry.img)) continue;
      const keywords = keywordsFromName(entry.name, true);
      if (keywords.size) STATE.compendiumKeywords[entry.name] = { keywords, img: entry.img };
    }
  }
}

/* -------------------------------------------- */
/*  Picker dialog                               */
/* -------------------------------------------- */

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function displayPath(path) {
  let p = path;
  try { p = decodeURIComponent(p); } catch { /* keep raw */ }
  return p;
}

async function openIconPicker(item, onConfirm, isBatch = false) {
  let selectedIcon = item.img;
  const activeTerms = new Set(keywordsFromName(item.name, true));

  function buildGrid() {
    const icons = findBestMatchingIcons(activeTerms, item.img);
    if (!icons.length) return `<p class="smart-icons-plus-empty">No matches found.</p>`;
    return icons.map(icon => {
      const cls = icon === selectedIcon ? "selectedIcon" : "";
      return `<img src="${esc(icon)}" class="${cls}" data-src="${esc(icon)}" title="${esc(displayPath(icon))}" loading="lazy">`;
    }).join("");
  }

  function buildTags() {
    const pills = [...activeTerms].map(tag =>
      `<span class="smart-icons-plus-tag">${esc(tag)}<button type="button" data-tag="${esc(tag)}">&times;</button></span>`
    ).join("");
    return `${pills}<input class="smart-icons-plus-tag-input" placeholder="Add keyword..." size="10">`;
  }

  function refresh(dialog) {
    dialog.element.querySelector(".smart-icons-plus-tags").innerHTML = buildTags();
    dialog.element.querySelector(".smart-icons-plus-grid").innerHTML = buildGrid();
    wireEvents(dialog);
  }

  function wireEvents(dialog) {
    const root = dialog.element;
    root.querySelectorAll(".smart-icons-plus-grid img").forEach(img => {
      img.addEventListener("click", () => {
        root.querySelectorAll(".smart-icons-plus-grid img").forEach(el => el.classList.remove("selectedIcon"));
        img.classList.add("selectedIcon");
        selectedIcon = img.dataset.src;
        const label = root.querySelector(".smart-icons-plus-path");
        if (label) label.textContent = displayPath(selectedIcon);
      });
    });

    root.querySelectorAll(".smart-icons-plus-tag button").forEach(btn => {
      btn.addEventListener("click", () => {
        activeTerms.delete(btn.dataset.tag);
        refresh(dialog);
      });
    });

    const input = root.querySelector(".smart-icons-plus-tag-input");
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      let added = false;
      for (const raw of input.value.split(/[\s,]+/)) {
        const word = raw.trim().toLowerCase();
        if (word.length >= 2 && !activeTerms.has(word)) { activeTerms.add(word); added = true; }
      }
      if (added) refresh(dialog);
    });
    input.focus();

    const reindexBtn = root.querySelector(".smart-icons-plus-reindex");
    if (reindexBtn && !reindexBtn.dataset.wired) {
      reindexBtn.dataset.wired = "1";
      reindexBtn.addEventListener("click", async () => {
        reindexBtn.disabled = true;
        reindexBtn.querySelector("i")?.classList.add("fa-spin");
        await buildIndex({ notify: true });
        reindexBtn.disabled = false;
        reindexBtn.querySelector("i")?.classList.remove("fa-spin");
        refresh(dialog);
      });
    }
  }

  const content = `
    <div class="smart-icons-plus-tags">${buildTags()}</div>
    <div class="smart-icons-plus-grid">${buildGrid()}</div>
    <div class="smart-icons-plus-footer">
      <span class="smart-icons-plus-path">${esc(displayPath(selectedIcon ?? ""))}</span>
      <button type="button" class="smart-icons-plus-reindex" title="Rescan all image files (use after uploading new images)">
        <i class="fas fa-rotate"></i> Rescan
      </button>
    </div>`;

  const buttons = [
    { action: "select", label: "Confirm", default: true },
    { action: "cancel", label: "Cancel" },
  ];
  if (isBatch) buttons.push({ action: "skip", label: "Skip" });

  const action = await foundry.applications.api.DialogV2.wait({
    window: { title: `Select Icon for ${item.name}` },
    classes: ["smart-icons-plus-dialog"],
    content,
    buttons,
    rejectClose: false,
    render: (_event, dialog) => wireEvents(dialog),
  });

  if (action === "select") {
    await item.update({ img: selectedIcon });
    onConfirm?.();
  } else if (action === "skip") {
    onConfirm?.();
  }
}

function batchSetIcons(actor) {
  const items = actor.items.contents;
  if (!items.length) {
    ui.notifications.warn("No items found on this actor.");
    return;
  }
  let index = 0;
  function processNext() {
    if (index >= items.length) {
      ui.notifications.info("Smart Icons Plus | Finished setting icons.");
      return;
    }
    openIconPicker(items[index++], processNext, true);
  }
  processNext();
}

/* -------------------------------------------- */
/*  Scoring (same rules as original)            */
/* -------------------------------------------- */

function calculateScore(searchTerms, keywords) {
  let score = 0;
  for (const term of searchTerms) {
    const maxDist = Math.max(SCORING.FUZZY_THRESHOLD, Math.ceil(term.length * SCORING.FUZZY_RATIO));
    for (const keyword of keywords) {
      if (term === keyword) {
        score += SCORING.DIRECT;
      } else if (keyword.includes(term) || term.includes(keyword)) {
        score += SCORING.PARTIAL;
      } else if (Math.abs(term.length - keyword.length) <= maxDist   // cheap pre-check, same result
                 && levenshtein(term, keyword) <= maxDist) {
        score += SCORING.FUZZY;
      }
    }
  }
  return score;
}

function findBestMatchingIcons(searchTerms, currentImg) {
  const scores = new Map();
  if (searchTerms.size) {
    for (const [path, keywords] of STATE.iconKeywords) {
      const score = calculateScore(searchTerms, keywords);
      if (score > 0) scores.set(path, score);
    }

    for (const { keywords, img } of Object.values(STATE.compendiumKeywords)) {
      const baseScore = calculateScore(searchTerms, keywords);
      if (baseScore <= 0) continue;
      let directHits = 0;
      for (const term of searchTerms) {
        if (keywords.has(term)) directHits++;
      }
      const bonus = COMPENDIUM_SCORING.BONUS * (directHits / searchTerms.size);
      scores.set(img, (scores.get(img) || 0) + baseScore + bonus);
    }
  }

  const unique = [...scores.entries()]
    .filter(([, score]) => score >= STATE.minScoreThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);

  // Keep the item's current image first.
  if (currentImg) {
    const idx = unique.indexOf(currentImg);
    if (idx > 0) unique.splice(idx, 1);
    if (idx !== 0) unique.unshift(currentImg);
  }

  return unique.slice(0, game.settings.get(MODULE_ID, "maxResults"));
}

/** Levenshtein distance with two rolling rows (faster for large indexes). */
function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}
