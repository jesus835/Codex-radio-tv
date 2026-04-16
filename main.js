const { app, BrowserWindow, session, dialog } = require("electron");
const path = require("path");
const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const multer = require("multer");

let mainWindow;
let playerWindow;
let loginWindow;
let server;

const PORT = 3001;
const ROOT_DIR = __dirname;
const IS_PACKAGED = typeof process !== "undefined" && process.resourcesPath && !ROOT_DIR.includes("node_modules");
const RESOURCES_DIR = IS_PACKAGED ? process.resourcesPath : ROOT_DIR;
const APP_DATA_ROOT = path.join(process.env.APPDATA || ROOT_DIR, "CodexRadioTVGuatemala");
const BIN_DIR = path.join(APP_DATA_ROOT, "bin");
const CACHE_DIR = path.join(APP_DATA_ROOT, "videos");
const LOCAL_MEDIA_DIR = path.join(APP_DATA_ROOT, "local-media");
const LOCAL_ALLOWED_EXT = new Set([
    ".mp3", ".wav", ".ogg", ".opus", ".m4a", ".aac", ".flac", ".webm", ".mp4", ".mov", ".mkv",
]);
const LOCAL_MIME_BY_EXT = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
};
const MAX_CACHE_FILES = 50;
const MAX_CONCURRENT_DOWNLOADS = 2;
const LINKS_FILE = path.join(APP_DATA_ROOT, "youtube-links.json");
const HISTORY_FILE = path.join(APP_DATA_ROOT, "youtube-history.json");
const PLAY_STATE_FILE = path.join(APP_DATA_ROOT, "youtube-play-state.json");
const COOKIES_FILE = path.join(APP_DATA_ROOT, "youtube-cookies.txt");
const WINDOW_STATE_FILE = path.join(APP_DATA_ROOT, "window-state.json");
const LOCAL_LIBRARY_FILE = path.join(APP_DATA_ROOT, "local-media-library.json");
const LICENSE_FILE = path.join(APP_DATA_ROOT, "license-key.json");
const LICENSE_SECRET = "C0d3x-R4d10-TV-Gu4t3m4l4-2026!sEcReT";
const YTDLP_CANDIDATES = [
    path.join(BIN_DIR, "core-runtime.exe"),
    path.join(RESOURCES_DIR, "core-runtime.exe"),
    path.join(ROOT_DIR, "core-runtime.exe"),
    path.join(BIN_DIR, "yt-dlp.exe"),
    path.join(RESOURCES_DIR, "yt-dlp.exe"),
    path.join(ROOT_DIR, "yt-dlp.exe"),
];
const PORTABLE_NODE_CANDIDATES = [
    path.join(BIN_DIR, "node.exe"),
    path.join(ROOT_DIR, "node-portable", "node.exe"),
    path.join(ROOT_DIR, "runtime", "node", "node.exe"),
    path.join(ROOT_DIR, "node.exe"),
    path.join(RESOURCES_DIR, "node.exe"),
];
const PREFERRED_VIDEO_FORMAT = "22/18/best[ext=mp4]/best";
const UPDATE_CHECK_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const UPDATE_CACHE_MS = 6 * 60 * 60 * 1000;
let YTDLP_BIN = "yt-dlp";
let PORTABLE_NODE_BIN = null;

const downloadJobs = new Map();
let updateCheckCache = {
    checkedAt: 0,
    payload: { updateAvailable: false },
};

// Mejora compatibilidad con captura de ventana (OBS/Window Capture)
app.disableHardwareAcceleration();

console.log("=== YouTube App Iniciando ===");
console.log("Ruta de yt-dlp:", YTDLP_BIN);
console.log("yt-dlp existe:", YTDLP_CANDIDATES.some((p) => fs.existsSync(p)));
console.log("Node runtime para yt-dlp:", PORTABLE_NODE_BIN || "node (sistema)");
console.log("Ruta de datos (escritura):", APP_DATA_ROOT);

if (!fs.existsSync(APP_DATA_ROOT)) fs.mkdirSync(APP_DATA_ROOT, { recursive: true });
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(LOCAL_MEDIA_DIR)) fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });

(function migrateBinToAppData() {
    const binInAppData = path.join(BIN_DIR, "core-runtime.exe");
    if (fs.existsSync(binInAppData)) return;
    const sources = [
        path.join(RESOURCES_DIR, "core-runtime.exe"),
        path.join(ROOT_DIR, "core-runtime.exe"),
        path.join(RESOURCES_DIR, "yt-dlp.exe"),
        path.join(ROOT_DIR, "yt-dlp.exe"),
    ];
    for (const src of sources) {
        if (fs.existsSync(src)) {
            try {
                fs.copyFileSync(src, binInAppData);
                console.log(`[bin-migrate] Copiado ${src} -> ${binInAppData}`);
            } catch (e) {
                console.error("[bin-migrate] No se pudo copiar:", e.message);
            }
            break;
        }
    }
})();

YTDLP_BIN = YTDLP_CANDIDATES.find((p) => fs.existsSync(p)) || "yt-dlp";
PORTABLE_NODE_BIN = PORTABLE_NODE_CANDIDATES.find((p) => fs.existsSync(p)) || null;

if (!fs.existsSync(LINKS_FILE)) {
    const legacyLinksFile = path.join(ROOT_DIR, "youtube-links.json");
    if (fs.existsSync(legacyLinksFile)) {
        fs.copyFileSync(legacyLinksFile, LINKS_FILE);
    } else {
        fs.writeFileSync(LINKS_FILE, "[]", "utf8");
    }
}
if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, "[]", "utf8");
}
if (!fs.existsSync(PLAY_STATE_FILE)) {
    fs.writeFileSync(PLAY_STATE_FILE, JSON.stringify({ currentId: "", paused: false }, null, 2), "utf8");
}
if (!fs.existsSync(COOKIES_FILE)) {
    const legacyCookiesFile = path.join(ROOT_DIR, "youtube-cookies.txt");
    if (fs.existsSync(legacyCookiesFile)) {
        fs.copyFileSync(legacyCookiesFile, COOKIES_FILE);
    }
}
if (!fs.existsSync(LOCAL_LIBRARY_FILE)) {
    fs.writeFileSync(LOCAL_LIBRARY_FILE, "[]", "utf8");
}
enforceCacheLimit();

let licenseState = { valid: false, key: "", expiresAt: "", daysLeft: 0, message: "" };

function verifyLicenseKey(keyStr) {
    try {
        const raw = String(keyStr || "").trim();
        if (!raw.startsWith("CODEX-")) return { valid: false, message: "Clave inválida." };
        const encoded = raw.replace(/^CODEX-/, "").replace(/-/g, "");
        const decoded = Buffer.from(encoded, "base64url").toString("utf8");
        const parts = decoded.split(".");
        if (parts.length !== 5) return { valid: false, message: "Formato de clave incorrecto." };
        const [iatStr, expStr, daysStr, nonce, sig] = parts;
        const data = `${iatStr}.${expStr}.${daysStr}.${nonce}`;
        const expectedSig = crypto
            .createHmac("sha256", LICENSE_SECRET)
            .update(data)
            .digest("hex")
            .slice(0, 12);
        if (sig !== expectedSig) return { valid: false, message: "Clave no auténtica." };
        const exp = Number(expStr) * 1000;
        const now = Date.now();
        const daysLeft = Math.max(0, Math.ceil((exp - now) / (24 * 60 * 60 * 1000)));
        if (now > exp) return { valid: false, message: "Licencia vencida.", expiresAt: new Date(exp).toISOString().slice(0, 10), daysLeft: 0 };
        return {
            valid: true,
            message: "",
            expiresAt: new Date(exp).toISOString().slice(0, 10),
            daysLeft,
            days: Number(daysStr) || 0,
        };
    } catch (error) {
        return { valid: false, message: "Error al verificar clave." };
    }
}

function readLicense() {
    try {
        const raw = fs.readFileSync(LICENSE_FILE, "utf8");
        const data = JSON.parse(raw);
        return data && typeof data.key === "string" ? data : null;
    } catch (error) {
        return null;
    }
}

function writeLicense(key) {
    const data = { key: String(key || "").trim(), activatedAt: new Date().toISOString() };
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2), "utf8");
    return data;
}

function refreshLicenseState() {
    const stored = readLicense();
    if (!stored || !stored.key) {
        licenseState = { valid: false, key: "", expiresAt: "", daysLeft: 0, message: "No hay licencia activada." };
        return licenseState;
    }
    const result = verifyLicenseKey(stored.key);
    licenseState = {
        valid: result.valid,
        key: stored.key,
        expiresAt: result.expiresAt || "",
        daysLeft: result.daysLeft || 0,
        message: result.message || "",
    };
    return licenseState;
}

function isLicenseValid() {
    return licenseState.valid === true;
}

refreshLicenseState();
console.log(`[license] Estado: valid=${licenseState.valid} expires=${licenseState.expiresAt} daysLeft=${licenseState.daysLeft} ${licenseState.message}`);

function isValidVideoId(id) {
    return /^[a-zA-Z0-9_-]{11}$/.test(id || "");
}

function isValidLocalMediaId(id) {
    return /^local_[a-f0-9]{32}$/i.test(String(id || ""));
}

function isQueueMediaId(id) {
    return isValidVideoId(id) || isValidLocalMediaId(id);
}

function getLocalDiskPath(id) {
    if (!isValidLocalMediaId(id) || !fs.existsSync(LOCAL_MEDIA_DIR)) return null;
    const match = fs.readdirSync(LOCAL_MEDIA_DIR).find((name) => name.startsWith(`${id}.`));
    return match ? path.join(LOCAL_MEDIA_DIR, match) : null;
}

function deleteLocalMediaFile(id) {
    const fullPath = getLocalDiskPath(id);
    if (!fullPath) return;
    try {
        fs.unlinkSync(fullPath);
        console.log(`[local-media] eliminado: ${path.basename(fullPath)}`);
    } catch (error) {
        console.error("[local-media] no se pudo eliminar archivo:", error.message);
    }
}

function mimeTypeForLocalFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return LOCAL_MIME_BY_EXT[ext] || "application/octet-stream";
}

function readLocalLibrary() {
    try {
        const raw = fs.readFileSync(LOCAL_LIBRARY_FILE, "utf8");
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        return [];
    }
}

function writeLocalLibrary(items) {
    fs.writeFileSync(LOCAL_LIBRARY_FILE, JSON.stringify(items, null, 2), "utf8");
}

function upsertLocalLibraryItem(item) {
    if (!item || !isValidLocalMediaId(item.id)) return readLocalLibrary();
    const library = readLocalLibrary();
    const index = library.findIndex((i) => i.id === item.id);
    const entry = {
        id: item.id,
        title: item.title || item.id,
        localExt: item.localExt || "",
        addedAt: item.addedAt || new Date().toISOString(),
        fileSize: Number(item.fileSize || 0) || 0,
    };
    if (index >= 0) {
        library[index] = { ...library[index], ...entry };
    } else {
        library.push(entry);
    }
    writeLocalLibrary(library);
    return library;
}

function removeLocalLibraryItem(id) {
    const library = readLocalLibrary().filter((i) => i.id !== id);
    writeLocalLibrary(library);
    return library;
}

function secondsToClock(totalSeconds) {
    const n = Number(totalSeconds || 0);
    if (!Number.isFinite(n) || n <= 0) return "0:00";
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function readLinks() {
    try {
        const raw = fs.readFileSync(LINKS_FILE, "utf8");
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        return [];
    }
}

function writeLinks(links) {
    fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2), "utf8");
}

function upsertLinkItem(link) {
    if (!link || !isQueueMediaId(link.id)) return readLinks();
    const links = readLinks();
    const index = links.findIndex((item) => item.id === link.id);
    const isLocal = link.source === "local" || isValidLocalMediaId(link.id);
    const previous = index >= 0 ? links[index] : null;
    const nextItem = {
        id: link.id,
        source: isLocal ? "local" : "youtube",
        url: link.url || (isLocal ? "" : `https://www.youtube.com/watch?v=${link.id}`),
        title: link.title || link.id,
        thumbnail: link.thumbnail || "",
        durationSeconds: Number(link.durationSeconds || 0) || 0,
        durationFormatted: link.durationFormatted || secondsToClock(link.durationSeconds || 0),
        channel: link.channel || "",
        localExt: isLocal ? String(link.localExt || previous?.localExt || "") : "",
    };
    if (index >= 0) {
        links[index] = { ...links[index], ...nextItem };
    } else {
        links.push(nextItem);
    }
    writeLinks(links);
    return links;
}

function readHistory() {
    try {
        const raw = fs.readFileSync(HISTORY_FILE, "utf8");
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        return [];
    }
}

function writeHistory(entries) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), "utf8");
}

function readPlayState() {
    try {
        const raw = fs.readFileSync(PLAY_STATE_FILE, "utf8");
        const data = JSON.parse(raw);
        return data && typeof data === "object"
            ? {
                currentId: isQueueMediaId(data.currentId) ? data.currentId : "",
                paused: !!data.paused,
                updatedAt: data.updatedAt || "",
            }
            : { currentId: "", paused: false };
    } catch (error) {
        return { currentId: "", paused: false };
    }
}

function writePlayState(state) {
    const nextState = {
        currentId: isQueueMediaId(state?.currentId) ? state.currentId : "",
        paused: !!state?.paused,
        updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PLAY_STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
    return nextState;
}

function normalizeTextTokens(parts) {
    const joined = parts
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, " ");
    const stopwords = new Set([
        "video", "official", "lyrics", "lyric", "audio", "music", "musica",
        "live", "en", "el", "la", "los", "las", "de", "del", "y", "a",
        "con", "sin", "para", "por", "tu", "mi", "te", "se", "un", "una",
        "hd", "ft", "feat"
    ]);
    return joined
        .split(/[^a-z0-9]+/i)
        .filter((token) => token && token.length >= 3 && !stopwords.has(token));
}

function normalizeChannelName(text) {
    return String(text || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function scoreSuggestion(link, history) {
    const linkTokens = normalizeTextTokens([link.title, link.channel]);
    const historyTokens = new Map();
    const historyChannels = new Map();

    for (const item of history.slice(0, 30)) {
        const weight = Math.max(1, 35 - Number(item.playCount || 1));
        for (const token of normalizeTextTokens([item.title, item.channel])) {
            historyTokens.set(token, (historyTokens.get(token) || 0) + weight);
        }
        const channel = normalizeChannelName(item.channel);
        if (channel) historyChannels.set(channel, (historyChannels.get(channel) || 0) + weight * 3);
    }

    let score = 0;
    const linkChannel = normalizeChannelName(link.channel);
    if (linkChannel && historyChannels.has(linkChannel)) {
        score += historyChannels.get(linkChannel);
    }
    for (const token of linkTokens) {
        score += historyTokens.get(token) || 0;
    }
    if (link.thumbnail) score += 2;
    if (Number(link.durationSeconds || 0) > 0) score += 1;
    return score;
}

function buildSuggestions() {
    const links = readLinks();
    const history = readHistory();
    if (!links.length) return [];

    const linkMap = new Map();
    for (const item of links) {
        if (item && isQueueMediaId(item.id)) linkMap.set(item.id, item);
    }
    for (const item of history) {
        if (item && isQueueMediaId(item.id) && !linkMap.has(item.id)) {
            linkMap.set(item.id, item);
        }
    }

    const candidates = Array.from(linkMap.values())
        .filter((item) => item && isQueueMediaId(item.id))
        .map((item) => ({
            ...item,
            score: scoreSuggestion(item, history),
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return String(b.lastPlayedAt || "").localeCompare(String(a.lastPlayedAt || ""));
        });

    return candidates.slice(0, 12).map(({ score, ...item }) => item);
}

const SEARCH_PAGE_SIZE = 12;

async function searchYouTubeVideos(query, page) {
    const q = String(query || "").trim();
    if (!q) return { items: [], page: 1, hasMore: false };
    const pageNum = Math.max(1, Number(page || 1) || 1);
    const totalToFetch = pageNum * SEARCH_PAGE_SIZE + 1;
    const args = [...ytBaseArgs(), "--flat-playlist", "-J", `ytsearch${totalToFetch}:${q}`];
    const { stdout } = await runYtDlp(args);
    const data = JSON.parse(stdout);
    const entries = Array.isArray(data?.entries) ? data.entries : [];

    const all = entries
        .filter((item) => isValidVideoId(item?.id))
        .map((item) => {
            const durationSeconds = Number(item.duration || 0) || 0;
            return {
                id: item.id,
                url: `https://www.youtube.com/watch?v=${item.id}`,
                title: item.title || item.id,
                thumbnail: item.thumbnail || "",
                durationSeconds,
                durationFormatted: secondsToClock(durationSeconds),
                channel: item.channel || item.uploader || "",
                viewCount: Number(item.view_count || 0),
            };
        });

    const rawCount = entries.length;
    const startIdx = (pageNum - 1) * SEARCH_PAGE_SIZE;
    const pageItems = all.slice(startIdx, startIdx + SEARCH_PAGE_SIZE);
    const hasMore = rawCount >= totalToFetch;

    return {
        items: pageItems.map(({ viewCount, ...rest }) => rest),
        page: pageNum,
        hasMore,
    };
}

function recordPlay(playItem) {
    if (!playItem || !isQueueMediaId(playItem.id)) return;
    const history = readHistory();
    const now = new Date().toISOString();
    const index = history.findIndex((item) => item.id === playItem.id);
    const previous = index >= 0 ? history[index] : null;
    const nextItem = {
        id: playItem.id,
        url: playItem.url || `https://www.youtube.com/watch?v=${playItem.id}`,
        title: playItem.title || previous?.title || playItem.id,
        thumbnail: playItem.thumbnail || previous?.thumbnail || "",
        durationSeconds: Number(playItem.durationSeconds || previous?.durationSeconds || 0) || 0,
        durationFormatted: playItem.durationFormatted || previous?.durationFormatted || secondsToClock(playItem.durationSeconds || 0),
        channel: playItem.channel || previous?.channel || "",
        playCount: Number(previous?.playCount || 0) + 1,
        lastPlayedAt: now,
    };
    if (index >= 0) history.splice(index, 1);
    history.unshift(nextItem);
    writeHistory(history.slice(0, 200));
}

function readWindowState() {
    try {
        const raw = fs.readFileSync(WINDOW_STATE_FILE, "utf8");
        const data = JSON.parse(raw);
        return data && typeof data === "object" ? data : {};
    } catch (error) {
        return {};
    }
}

function writeWindowState(state) {
    try {
        fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
    } catch (error) {
        console.error("No se pudo guardar estado de ventana:", error.message);
    }
}

function hasValidBounds(bounds) {
    return (
        bounds &&
        Number.isInteger(bounds.x) &&
        Number.isInteger(bounds.y) &&
        Number.isInteger(bounds.width) &&
        Number.isInteger(bounds.height) &&
        bounds.width > 100 &&
        bounds.height > 100
    );
}

function savePlayerWindowBounds(win) {
    if (!win || win.isDestroyed()) return;
    const state = readWindowState();
    state.playerBounds = win.getBounds();
    writeWindowState(state);
}

function moveItemInArray(items, fromIndex, toIndex) {
    const arr = items.slice();
    if (fromIndex < 0 || fromIndex >= arr.length) return arr;
    if (toIndex < 0) toIndex = 0;
    if (toIndex >= arr.length) toIndex = arr.length - 1;
    if (fromIndex === toIndex) return arr;
    const [item] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, item);
    return arr;
}

function getCachePath(videoId) {
    return path.join(CACHE_DIR, `${videoId}.mp4`);
}

function listCacheFilesSortedByOldest() {
    if (!fs.existsSync(CACHE_DIR)) return [];
    return fs
        .readdirSync(CACHE_DIR)
        .filter((name) => name.toLowerCase().endsWith(".mp4"))
        .map((name) => {
            const fullPath = path.join(CACHE_DIR, name);
            const stat = fs.statSync(fullPath);
            return { name, fullPath, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function getProtectedQueueIds() {
    return readLinks()
        .map((item) => item && item.id)
        .filter((id) => isQueueMediaId(id));
}

function enforceCacheLimit() {
    const files = listCacheFilesSortedByOldest();
    if (files.length <= MAX_CACHE_FILES) return;

    const extraCount = files.length - MAX_CACHE_FILES;
    const protectedQueueIds = getProtectedQueueIds();
    const queueIndexById = new Map(protectedQueueIds.map((id, index) => [id, index]));
    const toDelete = files
        .slice()
        .sort((a, b) => {
            const idA = path.basename(a.name, ".mp4");
            const idB = path.basename(b.name, ".mp4");
            const idxA = queueIndexById.has(idA) ? queueIndexById.get(idA) : Number.POSITIVE_INFINITY;
            const idxB = queueIndexById.has(idB) ? queueIndexById.get(idB) : Number.POSITIVE_INFINITY;
            const aInQueue = Number.isFinite(idxA);
            const bInQueue = Number.isFinite(idxB);

            if (aInQueue !== bInQueue) return aInQueue ? 1 : -1;
            if (aInQueue && bInQueue && idxA !== idxB) return idxB - idxA;
            return a.mtimeMs - b.mtimeMs;
        })
        .slice(0, extraCount);
    for (const file of toDelete) {
        try {
            fs.unlinkSync(file.fullPath);
            console.log(`🧹 Caché eliminado: ${file.name}`);
        } catch (error) {
            console.error(`No se pudo borrar caché ${file.name}:`, error.message);
        }
    }
}

function ytBaseArgs() {
    const jsRuntime = PORTABLE_NODE_BIN ? `node:${PORTABLE_NODE_BIN}` : "node";
    const args = ["--js-runtimes", jsRuntime, "--extractor-args", "youtube:player_client=web,web_safari"];
    if (fs.existsSync(COOKIES_FILE)) args.unshift("--cookies", COOKIES_FILE);
    return args;
}

function getLocalYtDlpVersion() {
    return new Promise((resolve) => {
        const child = spawn(YTDLP_BIN, ["--version"]);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", (error) => {
            console.error("[update-check] No se pudo leer version local:", error.message);
            resolve("");
        });
        child.on("close", (code) => {
            if (code !== 0) {
                console.error("[update-check] yt-dlp --version fallo:", stderr.trim());
                resolve("");
                return;
            }
            resolve(stdout.trim());
        });
    });
}

function compareVersionStrings(left, right) {
    const leftParts = String(left || "").split(/[^0-9]+/).filter(Boolean).map(Number);
    const rightParts = String(right || "").split(/[^0-9]+/).filter(Boolean).map(Number);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        const a = leftParts[index] || 0;
        const b = rightParts[index] || 0;
        if (a > b) return 1;
        if (a < b) return -1;
    }
    return 0;
}

function fetchRemoteUpdateInfo() {
    return new Promise((resolve, reject) => {
        const req = https.get(UPDATE_CHECK_URL, {
            headers: {
                "User-Agent": "CodexRadioUpdateCheck/1.0",
                "Accept": "application/vnd.github+json",
            },
        }, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk.toString()));
            res.on("end", () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    const json = JSON.parse(body);
                    resolve({
                        version: String(json.tag_name || "").replace(/^v/i, "").trim(),
                        url: json.html_url || "https://github.com/yt-dlp/yt-dlp/releases",
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on("error", reject);
    });
}

async function getUpdateStatus(force = false) {
    const now = Date.now();
    if (!force && updateCheckCache.checkedAt && now - updateCheckCache.checkedAt < UPDATE_CACHE_MS) {
        return updateCheckCache.payload;
    }

    const localVersion = await getLocalYtDlpVersion();
    try {
        const remote = await fetchRemoteUpdateInfo();
        const updateAvailable = !!localVersion && !!remote.version && compareVersionStrings(remote.version, localVersion) > 0;
        const payload = {
            checkedAt: new Date().toISOString(),
            currentVersion: localVersion,
            latestVersion: remote.version,
            updateAvailable,
            sourceUrl: remote.url,
            message: updateAvailable
                ? "Nueva actualizacion disponible. Puede seguir usando el programa mientras funcione. Si deja de funcionar, necesita adquirir la actualizacion."
                : "",
        };
        updateCheckCache = { checkedAt: now, payload };
        console.log(`[update-check] local=${localVersion || "?"} remote=${remote.version || "?"} available=${updateAvailable}`);
        return payload;
    } catch (error) {
        const payload = {
            checkedAt: new Date().toISOString(),
            currentVersion: localVersion,
            latestVersion: "",
            updateAvailable: false,
            sourceUrl: "",
            message: "",
            error: error.message || "No se pudo verificar actualizacion",
        };
        updateCheckCache = { checkedAt: now, payload };
        console.error("[update-check] Error verificando actualizacion:", payload.error);
        return payload;
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const doRequest = (requestUrl, redirects) => {
            if (redirects > 5) { reject(new Error("Demasiados redirects")); return; }
            const mod = requestUrl.startsWith("https") ? https : require("http");
            mod.get(requestUrl, { headers: { "User-Agent": "CodexRadioTV/1.0" } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    doRequest(res.headers.location, redirects + 1);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(); });
                file.on("error", (err) => { fs.unlink(dest, () => {}); reject(err); });
            }).on("error", reject);
        };
        doRequest(url, 0);
    });
}

async function autoUpdateYtDlp() {
    refreshLicenseState();
    if (!isLicenseValid()) {
        console.log("[core-update] Licencia no válida, no se actualiza.");
        return { updated: false, reason: "no_license" };
    }
    try {
        const localVersion = await getLocalYtDlpVersion();
        const remote = await fetchRemoteUpdateInfo();
        if (!remote.version || !localVersion) {
            console.log("[core-update] No se pudo determinar versiones.");
            return { updated: false, reason: "no_version_info" };
        }
        if (compareVersionStrings(remote.version, localVersion) <= 0) {
            console.log(`[core-update] Ya tienes la última versión: ${localVersion}`);
            return { updated: false, reason: "up_to_date", version: localVersion };
        }
        console.log(`[core-update] Actualizando ${localVersion} -> ${remote.version}...`);

        const targetBin = path.join(BIN_DIR, "core-runtime.exe");
        const backupPath = targetBin + ".bak";
        const tempPath = targetBin + ".new";
        const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${remote.version}/yt-dlp.exe`;

        console.log(`[core-update] Descargando desde: ${downloadUrl}`);
        await downloadFile(downloadUrl, tempPath);

        const newSize = fs.statSync(tempPath).size;
        if (newSize < 1024 * 100) {
            fs.unlinkSync(tempPath);
            console.error("[core-update] Archivo descargado demasiado pequeño, descartando.");
            return { updated: false, reason: "bad_download" };
        }

        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
        if (fs.existsSync(targetBin)) fs.renameSync(targetBin, backupPath);
        fs.renameSync(tempPath, targetBin);

        YTDLP_BIN = targetBin;
        const newVersion = await getLocalYtDlpVersion();
        console.log(`[core-update] Actualizado a: ${newVersion}`);
        updateCheckCache = { checkedAt: 0, payload: { updateAvailable: false } };
        return { updated: true, oldVersion: localVersion, newVersion: newVersion || remote.version };
    } catch (error) {
        console.error("[core-update] Error actualizando:", error.message || error);
        return { updated: false, reason: "error", error: error.message };
    }
}

function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        console.log("[yt-dlp] Ejecutando:", YTDLP_BIN, args.join(" "));
        const child = spawn(YTDLP_BIN, args);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr || `yt-dlp salió con código ${code}`));
        });
    });
}

async function extractSingleVideoFromInput(url) {
    console.log("[extract] URL recibida:", url);
    const isPlaylistOnlyUrl = /[?&]list=/.test(url) && !/[?&]v=/.test(url);
    if (isPlaylistOnlyUrl) {
        throw new Error("Las playlists están desactivadas. Agrega links de video individuales.");
    }

    const match = String(url).match(/[?&]v=([a-zA-Z0-9_-]{11})/) || String(url).match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error("No se pudo obtener ID de video válido.");
    const id = match[1];

    try {
        const canonicalUrl = `https://www.youtube.com/watch?v=${id}`;
        const args = [...ytBaseArgs(), "-J", canonicalUrl];
        const { stdout } = await runYtDlp(args);
        const info = JSON.parse(stdout);
        const durationSeconds = Number(info.duration || 0) || 0;
        return {
            id,
            url: canonicalUrl,
            title: info.title || id,
            thumbnail: info.thumbnail || "",
            durationSeconds,
            durationFormatted: secondsToClock(durationSeconds),
            channel: info.channel || info.uploader || "",
        };
    } catch (error) {
        console.error("[extract] No se pudo completar metadata para", id, error.message);
        return {
            id,
            url: `https://www.youtube.com/watch?v=${id}`,
            title: id,
            thumbnail: "",
            durationSeconds: 0,
            durationFormatted: "0:00",
            channel: "",
        };
    }
}

function warmCache(videoId) {
    if (!isValidVideoId(videoId)) return;
    enforceCacheLimit();
    const target = getCachePath(videoId);
    if (fs.existsSync(target)) {
        console.log(`[cache] ${videoId}: ya existe en caché -> ${target}`);
        return;
    }
    if (downloadJobs.has(videoId)) {
        console.log(`[cache] ${videoId}: descarga ya en progreso`);
        return;
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [...ytBaseArgs(), "-f", PREFERRED_VIDEO_FORMAT, "-o", target, url];
    console.log(`[cache] ${videoId}: iniciando descarga`);
    console.log(`[cache] ${videoId}: destino ${target}`);
    console.log(`[cache] ${videoId}: formato ${PREFERRED_VIDEO_FORMAT}`);
    const child = spawn(YTDLP_BIN, args);
    downloadJobs.set(videoId, child);
    child.stdout.on("data", (d) => console.log(`yt-dlp cache ${videoId} [out]: ${d.toString().trim()}`));
    child.stderr.on("data", (d) => console.log(`yt-dlp cache ${videoId}: ${d.toString().trim()}`));
    child.on("close", () => {
        const existsAfter = fs.existsSync(target);
        console.log(`[cache] ${videoId}: proceso finalizado. existe=${existsAfter}`);
        downloadJobs.delete(videoId);
        enforceCacheLimit();
        scheduleQueueCaching();
    });
    child.on("error", (error) => {
        console.error(`[cache] ${videoId}: error lanzando yt-dlp ->`, error.message);
        downloadJobs.delete(videoId);
        scheduleQueueCaching();
    });
}

let queueCachingTimer = null;

function scheduleQueueCaching(delayMs = 250) {
    if (queueCachingTimer) clearTimeout(queueCachingTimer);
    queueCachingTimer = setTimeout(() => {
        queueCachingTimer = null;
        ensureQueueCached();
    }, delayMs);
}

function ensureQueueCached() {
    enforceCacheLimit();

    const queueIds = readLinks()
        .map((item) => item && item.id)
        .filter((id) => isValidVideoId(id));

    if (!queueIds.length) {
        console.log("[queue-cache] no hay elementos en cola para preparar");
        return;
    }

    const cacheFiles = listCacheFilesSortedByOldest();
    const cachedIds = new Set(cacheFiles.map((file) => path.basename(file.name, ".mp4")));
    const downloadingIds = new Set(downloadJobs.keys());
    const reservedCount = cachedIds.size + downloadingIds.size;
    const availableSlots = Math.max(0, MAX_CACHE_FILES - reservedCount);
    const availableWorkers = Math.max(0, MAX_CONCURRENT_DOWNLOADS - downloadJobs.size);

    if (availableSlots <= 0 || availableWorkers <= 0) {
        console.log(`[queue-cache] cache llena o sin workers libres (cache=${cachedIds.size}, descargando=${downloadJobs.size})`);
        return;
    }

    const pendingIds = queueIds.filter((id) => !cachedIds.has(id) && !downloadingIds.has(id));
    if (!pendingIds.length) {
        console.log("[queue-cache] la cola ya está cubierta en caché");
        return;
    }

    const toStart = pendingIds.slice(0, Math.min(availableSlots, availableWorkers));
    console.log(`[queue-cache] iniciando ${toStart.length} descarga(s) pendiente(s); cache=${cachedIds.size}, descargando=${downloadJobs.size}, cola=${queueIds.length}`);
    toStart.forEach((id) => warmCache(id));
}

function streamDirect(videoId, res, req) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const args = [...ytBaseArgs(), "-f", PREFERRED_VIDEO_FORMAT, "-o", "-", url];
    console.log(`[stream-direct] ${videoId}: iniciando con formato ${PREFERRED_VIDEO_FORMAT}`);
    const child = spawn(YTDLP_BIN, args);

    res.setHeader("Content-Type", "video/mp4");
    child.stdout.pipe(res);

    child.stderr.on("data", (d) => console.log(`yt-dlp direct ${videoId}: ${d.toString().trim()}`));
    child.on("error", (err) => {
        console.error("Error stream directo:", err);
        if (!res.headersSent) res.status(500).send("Error en stream directo.");
    });
    req.on("close", () => child.kill());
}

function sendCacheHeaders(res, fileSize, contentType) {
    res.setHeader("Content-Type", contentType || "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", fileSize);
}

function streamFileWithRange(req, res, filePath, contentType) {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const mime = contentType || "video/mp4";

    if (!range) {
        sendCacheHeaders(res, fileSize, mime);
        fs.createReadStream(filePath).pipe(res);
        return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
        return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : fileSize - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= fileSize) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`).end();
        return;
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Type", mime);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    res.setHeader("Content-Length", chunkSize);

    fs.createReadStream(filePath, { start, end }).pipe(res);
}

function createServer() {
    const expressApp = express();
    const localUploadStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(LOCAL_MEDIA_DIR)) fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
            cb(null, LOCAL_MEDIA_DIR);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname || "").toLowerCase();
            if (!LOCAL_ALLOWED_EXT.has(ext)) {
                cb(new Error("Formato no soportado. Use mp3, wav, m4a, ogg, flac, mp4, webm, mov o mkv."));
                return;
            }
            const id = `local_${crypto.randomBytes(16).toString("hex")}`;
            req._uploadedLocalId = id;
            req._uploadedLocalExt = ext;
            cb(null, `${id}${ext}`);
        },
    });
    const uploadLocalMedia = multer({
        storage: localUploadStorage,
        limits: { fileSize: 250 * 1024 * 1024 },
    });

    expressApp.use(express.json());
    expressApp.use("/videos", express.static(CACHE_DIR));
    expressApp.use("/public", express.static(path.join(ROOT_DIR, "public")));

    expressApp.get("/", (req, res) => res.sendFile(path.join(ROOT_DIR, "youtube.html")));
    expressApp.get("/youtube.html", (req, res) => res.sendFile(path.join(ROOT_DIR, "youtube.html")));
    expressApp.get("/watch.html", (req, res) => res.sendFile(path.join(ROOT_DIR, "watch.html")));

    expressApp.get("/api/app/license", (req, res) => {
        const state = refreshLicenseState();
        res.json({ ok: true, ...state });
    });

    expressApp.post("/api/app/license", (req, res) => {
        const key = String(req.body?.key || "").trim();
        if (!key) return res.status(400).json({ ok: false, error: "Ingrese una clave." });
        const result = verifyLicenseKey(key);
        if (!result.valid) {
            return res.json({ ok: false, error: result.message || "Clave inválida o vencida." });
        }
        writeLicense(key);
        const state = refreshLicenseState();
        console.log(`[license] Clave activada: expires=${state.expiresAt} daysLeft=${state.daysLeft}`);
        return res.json({ ok: true, ...state });
    });

    expressApp.use("/api/", (req, res, next) => {
        if (req.path === "/app/license") return next();
        if (!isLicenseValid()) {
            return res.status(403).json({ ok: false, error: "license_expired", message: "Licencia no válida o vencida." });
        }
        next();
    });

    expressApp.get("/login-youtube", (req, res) => {
        openYouTubeLogin();
        res.json({ success: true });
    });

    expressApp.post("/api/local/upload", (req, res) => {
        uploadLocalMedia.single("file")(req, res, (err) => {
            if (err) {
                const message = err.message || "Error al subir archivo";
                console.error("[local-media]", message);
                return res.status(400).json({ ok: false, error: message });
            }
            try {
                if (!req.file) {
                    return res.status(400).json({ ok: false, error: "Seleccione un archivo de audio o video." });
                }
                const id = req._uploadedLocalId;
                const ext = req._uploadedLocalExt;
                const rawName = path.basename(req.file.originalname || "") || `${id}${ext}`;
                const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 160) || `${id}${ext}`;
                const library = upsertLocalLibraryItem({
                    id,
                    title: safeName,
                    localExt: ext,
                    fileSize: req.file.size || 0,
                });
                console.log(`[local-media] biblioteca: ${id} (${safeName})`);
                return res.json({ ok: true, library });
            } catch (error) {
                console.error("[local-media]", error);
                return res.status(500).json({ ok: false, error: error.message || "Error interno al subir archivo." });
            }
        });
    });

    expressApp.get("/api/local/library", (req, res) => {
        res.json(readLocalLibrary());
    });

    expressApp.post("/api/local/add-to-queue", (req, res) => {
        try {
            const id = String(req.body?.id || "");
            if (!isValidLocalMediaId(id)) return res.status(400).json({ ok: false, error: "ID inválido" });
            const library = readLocalLibrary();
            const libItem = library.find((i) => i.id === id);
            if (!libItem) return res.status(404).json({ ok: false, error: "Archivo no encontrado en la biblioteca." });
            const links = upsertLinkItem({
                id: libItem.id,
                source: "local",
                url: "",
                title: libItem.title,
                thumbnail: "",
                durationSeconds: 0,
                durationFormatted: "0:00",
                channel: "Multimedia local",
                localExt: libItem.localExt,
            });
            console.log(`[local-media] añadido a cola desde biblioteca: ${id}`);
            return res.json({ ok: true, links });
        } catch (error) {
            console.error("[local-media]", error);
            return res.status(500).json({ ok: false, error: error.message || "Error al añadir a cola." });
        }
    });

    expressApp.post("/api/local/add-all-to-queue", (req, res) => {
        try {
            const library = readLocalLibrary();
            if (!library.length) return res.json({ ok: true, links: readLinks() });
            let links = readLinks();
            for (const libItem of library) {
                if (!isValidLocalMediaId(libItem.id)) continue;
                links = upsertLinkItem({
                    id: libItem.id,
                    source: "local",
                    url: "",
                    title: libItem.title,
                    thumbnail: "",
                    durationSeconds: 0,
                    durationFormatted: "0:00",
                    channel: "Multimedia local",
                    localExt: libItem.localExt,
                });
            }
            console.log(`[local-media] añadidos ${library.length} archivos a cola desde biblioteca`);
            return res.json({ ok: true, links });
        } catch (error) {
            console.error("[local-media]", error);
            return res.status(500).json({ ok: false, error: error.message || "Error al añadir todo a cola." });
        }
    });

    expressApp.delete("/api/local/library/:id", (req, res) => {
        const id = req.params.id;
        if (!isValidLocalMediaId(id)) return res.status(400).json({ ok: false, error: "ID inválido" });
        const links = readLinks().filter((i) => i.id !== id);
        writeLinks(links);
        const library = removeLocalLibraryItem(id);
        deleteLocalMediaFile(id);
        console.log(`[local-media] eliminado de biblioteca y disco: ${id}`);
        return res.json({ ok: true, library, links });
    });

    expressApp.head("/api/local/stream/:id", (req, res) => {
        const id = req.params.id;
        if (!isValidLocalMediaId(id)) return res.sendStatus(400);
        const filePath = getLocalDiskPath(id);
        if (!filePath || !fs.existsSync(filePath)) return res.sendStatus(404);
        const mime = mimeTypeForLocalFile(filePath);
        const fileSize = fs.statSync(filePath).size;
        sendCacheHeaders(res, fileSize, mime);
        return res.sendStatus(200);
    });

    expressApp.get("/api/local/stream/:id", (req, res) => {
        const id = req.params.id;
        if (!isValidLocalMediaId(id)) return res.status(400).send("ID inválido");
        const filePath = getLocalDiskPath(id);
        if (!filePath || !fs.existsSync(filePath)) return res.status(404).send("Archivo no encontrado");
        const mime = mimeTypeForLocalFile(filePath);
        streamFileWithRange(req, res, filePath, mime);
    });

    expressApp.get("/api/youtube/links", (req, res) => {
        res.json(readLinks());
    });

    expressApp.get("/api/youtube/state", (req, res) => {
        res.json(readPlayState());
    });

    expressApp.get("/api/youtube/suggestions", (req, res) => {
        res.json(buildSuggestions());
    });

    expressApp.get("/api/app/update-status", async (req, res) => {
        try {
            const force = String(req.query?.force || "").trim() === "1";
            const status = await getUpdateStatus(force);
            res.json({ ok: true, ...status });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message || "No se pudo verificar actualizacion." });
        }
    });

    expressApp.post("/api/app/update-core", async (req, res) => {
        try {
            const result = await autoUpdateYtDlp();
            res.json({ ok: true, ...result });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message || "Error al actualizar Codex Radio." });
        }
    });

    expressApp.get("/api/youtube/search", async (req, res) => {
        try {
            const q = String(req.query?.q || "").trim();
            if (!q) return res.json({ items: [], page: 1, hasMore: false });
            const page = Number(req.query?.page || 1) || 1;
            console.log(`[search] Busqueda recibida: "${q}" pagina=${page}`);
            const startedAt = Date.now();
            const result = await searchYouTubeVideos(q, page);
            console.log(`[search] Resultados: ${result.items.length} en ${Date.now() - startedAt}ms (pagina ${result.page}, hasMore=${result.hasMore})`);
            res.json(result);
        } catch (error) {
            console.error("Error buscando en YouTube:", error);
            res.status(500).json({ ok: false, error: error.message || "No se pudo buscar en YouTube." });
        }
    });

    expressApp.post("/api/youtube/links", async (req, res) => {
        try {
            const inputUrl = String(req.body?.url || "").trim();
            if (!inputUrl) return res.status(400).json({ ok: false, error: "URL requerida" });
            console.log("[api/links] Añadir solicitado:", inputUrl);

            const extracted = await extractSingleVideoFromInput(inputUrl);
            const current = upsertLinkItem(extracted);
            console.log(`[api/links] Añadido ${extracted.id} - ${extracted.title}`);
            warmCache(extracted.id);
            scheduleQueueCaching();
            res.json({ ok: true, links: current });
        } catch (error) {
            console.error("Error agregando link:", error);
            res.status(500).json({ ok: false, error: error.message || "No se pudo agregar el link." });
        }
    });

    expressApp.post("/api/youtube/prepare", (req, res) => {
        try {
            const id = String(req.body?.id || "");
            if (!isQueueMediaId(id)) return res.status(400).json({ ok: false, error: "ID inválido" });
            console.log(`[prepare] Solicitud recibida para ${id}`);
            const links = upsertLinkItem({
                id,
                url: req.body?.url,
                title: req.body?.title,
                thumbnail: req.body?.thumbnail,
                durationSeconds: req.body?.durationSeconds,
                durationFormatted: req.body?.durationFormatted,
                channel: req.body?.channel,
                source: req.body?.source,
                localExt: req.body?.localExt,
            });
            if (isValidVideoId(id)) {
                console.log(`[prepare] Datos guardados para ${id}. Lanzando warmCache`);
                warmCache(id);
                scheduleQueueCaching();
            }
            return res.json({ ok: true, links });
        } catch (error) {
            console.error("Error preparando video:", error);
            return res.status(500).json({ ok: false, error: error.message || "No se pudo preparar el video." });
        }
    });

    expressApp.post("/api/youtube/play", (req, res) => {
        const id = String(req.body?.id || "");
        if (!isQueueMediaId(id)) return res.status(400).json({ ok: false, error: "ID inválido" });

        const links = readLinks();
        const known = links.find((item) => item.id === id) || req.body || {};
        recordPlay({
            id,
            url: known.url,
            title: known.title,
            thumbnail: known.thumbnail,
            durationSeconds: known.durationSeconds,
            durationFormatted: known.durationFormatted,
            channel: known.channel,
        });
        res.json({ ok: true });
    });

    expressApp.post("/api/youtube/state", (req, res) => {
        const currentId = String(req.body?.currentId || "");
        const paused = !!req.body?.paused;
        const state = writePlayState({ currentId, paused });
        res.json({ ok: true, state });
    });

    expressApp.delete("/api/youtube/links/:id", (req, res) => {
        const id = req.params.id;
        if (!isQueueMediaId(id)) return res.status(400).json({ ok: false, error: "ID inválido" });
        const filtered = readLinks().filter((i) => i.id !== id);
        writeLinks(filtered);
        scheduleQueueCaching();
        res.json({ ok: true, links: filtered });
    });

    expressApp.post("/api/youtube/links/reorder", (req, res) => {
        const id = String(req.body?.id || "");
        const to = String(req.body?.to || "");
        const fromIndexRaw = Number(req.body?.fromIndex);
        const toIndexRaw = Number(req.body?.toIndex);

        const links = readLinks();
        if (!links.length) return res.json({ ok: true, links });

        let fromIndex = Number.isInteger(fromIndexRaw) ? fromIndexRaw : -1;
        if (fromIndex < 0) {
            fromIndex = links.findIndex((item) => item.id === id);
        }
        if (fromIndex < 0) {
            return res.status(400).json({ ok: false, error: "No se encontró el elemento a mover." });
        }

        let toIndex;
        if (Number.isInteger(toIndexRaw)) {
            toIndex = toIndexRaw;
        } else if (to === "first") {
            toIndex = 0;
        } else if (to === "last") {
            toIndex = links.length - 1;
        } else if (to === "up") {
            toIndex = fromIndex - 1;
        } else if (to === "down") {
            toIndex = fromIndex + 1;
        } else {
            return res.status(400).json({ ok: false, error: "Destino inválido." });
        }

        const reordered = moveItemInArray(links, fromIndex, toIndex);
        writeLinks(reordered);
        scheduleQueueCaching();
        return res.json({ ok: true, links: reordered });
    });

    expressApp.head("/api/youtube/stream/:id", (req, res) => {
        const id = req.params.id;
        if (!isValidVideoId(id)) return res.sendStatus(400);
        const file = getCachePath(id);
        if (fs.existsSync(file)) {
            const fileSize = fs.statSync(file).size;
            sendCacheHeaders(res, fileSize);
            console.log(`[stream-head] ${id}: caché lista (${fileSize} bytes)`);
            return res.sendStatus(200);
        }
        console.log(`[stream-head] ${id}: aún no está en caché`);
        return res.sendStatus(404);
    });

    expressApp.get("/api/youtube/stream/:id", (req, res) => {
        const id = req.params.id;
        if (!isValidVideoId(id)) return res.status(400).send("ID inválido");
        const file = getCachePath(id);
        if (!fs.existsSync(file)) return res.status(404).send("No está en caché");
        console.log(`[stream-cache] ${id}: reproduciendo archivo local ${file}`);
        streamFileWithRange(req, res, file, "video/mp4");
    });

    expressApp.get("/api/youtube/stream-direct/:id", (req, res) => {
        const id = req.params.id;
        if (!isValidVideoId(id)) return res.status(400).send("ID inválido");
        streamDirect(id, res, req);
    });

    expressApp.delete("/api/youtube/cache/:id", (req, res) => {
        const id = req.params.id;
        if (!isValidVideoId(id)) return res.status(400).json({ ok: false, error: "ID inválido" });
        const file = getCachePath(id);
        if (fs.existsSync(file)) {
            try {
                fs.unlinkSync(file);
            } catch (error) {
                console.error("No se pudo borrar caché:", error);
            }
        }
        scheduleQueueCaching();
        res.json({ ok: true });
    });

    server = expressApp.listen(PORT, () => {
        console.log(`✅ Servidor Express corriendo en http://localhost:${PORT}`);
        setTimeout(() => ensureQueueCached(), 1200);
    }).on("error", (err) => {
        console.error("❌ Error al iniciar servidor:", err);
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        autoHideMenuBar: true,
        title: "Codex Control",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    mainWindow.on("page-title-updated", (event) => event.preventDefault());
    mainWindow.setTitle("Codex Control");

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.includes("/watch.html")) {
            if (playerWindow && !playerWindow.isDestroyed()) {
                playerWindow.show();
                playerWindow.focus();
                playerWindow.setTitle("Codex Player");
                playerWindow.loadURL(url);
                return { action: "deny" };
            }

            const windowState = readWindowState();
            const savedBounds = windowState.playerBounds;
            const playerWindowOptions = {
                width: 980,
                height: 620,
                autoHideMenuBar: true,
                title: "Codex Player",
                alwaysOnTop: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                },
            };
            if (hasValidBounds(savedBounds)) {
                playerWindowOptions.x = savedBounds.x;
                playerWindowOptions.y = savedBounds.y;
                playerWindowOptions.width = savedBounds.width;
                playerWindowOptions.height = savedBounds.height;
            }

            playerWindow = new BrowserWindow({
                ...playerWindowOptions,
            });
            playerWindow.on("page-title-updated", (event) => event.preventDefault());
            playerWindow.setTitle("Codex Player");
            playerWindow.setAlwaysOnTop(true, "floating");
            playerWindow.on("move", () => savePlayerWindowBounds(playerWindow));
            playerWindow.on("resize", () => savePlayerWindowBounds(playerWindow));
            playerWindow.on("close", () => savePlayerWindowBounds(playerWindow));
            playerWindow.on("closed", () => {
                playerWindow = null;
            });
            playerWindow.loadURL(url);
            return { action: "deny" };
        }
        return { action: "allow" };
    });

    mainWindow.loadURL(`http://localhost:${PORT}/youtube.html`);
    mainWindow.on("close", () => {
        if (playerWindow && !playerWindow.isDestroyed()) {
            playerWindow.close();
        }
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

function openYouTubeLogin() {
    if (loginWindow) {
        loginWindow.focus();
        return;
    }

    loginWindow = new BrowserWindow({
        width: 920,
        height: 760,
        parent: mainWindow,
        modal: false,
        title: "Codex Login YouTube",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: "persist:youtube",
        },
    });
    loginWindow.on("page-title-updated", (event) => event.preventDefault());
    loginWindow.setTitle("Codex Login YouTube");

    loginWindow.loadURL("https://accounts.google.com/ServiceLogin?service=youtube");
    loginWindow.on("closed", async () => {
        loginWindow = null;
        await saveCookiesFromSession();
    });
}

async function saveCookiesFromSession() {
    try {
        const store = session.fromPartition("persist:youtube");
        const [youtube, google] = await Promise.all([
            store.cookies.get({ domain: ".youtube.com" }),
            store.cookies.get({ domain: ".google.com" }),
        ]);
        const all = [...youtube, ...google];
        if (!all.length) return;

        let output = "# Netscape HTTP Cookie File\n";
        output += "# This file is generated by Electron. Do not edit.\n\n";
        for (const cookie of all) {
            const domain = cookie.domain.startsWith(".") ? cookie.domain : `.${cookie.domain}`;
            const flag = "TRUE";
            const cookiePath = cookie.path || "/";
            const secure = cookie.secure ? "TRUE" : "FALSE";
            const expiration = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
            output += `${domain}\t${flag}\t${cookiePath}\t${secure}\t${expiration}\t${cookie.name}\t${cookie.value}\n`;
        }
        fs.writeFileSync(COOKIES_FILE, output, "utf8");
        console.log(`✅ Cookies guardadas: ${all.length}`);
    } catch (error) {
        console.error("❌ Error guardando cookies:", error);
    }
}

function setupAutoUpdater() {
    refreshLicenseState();
    if (!isLicenseValid()) {
        console.log("[auto-update] Licencia no válida, auto-update desactivado.");
        return;
    }
    try {
        const { autoUpdater } = require("electron-updater");
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;

        autoUpdater.on("update-available", (info) => {
            const version = info.version || "nueva";
            console.log(`[auto-update] Actualización disponible: v${version}`);
            dialog
                .showMessageBox(mainWindow, {
                    type: "info",
                    title: "Actualización disponible",
                    message: `Hay una nueva versión de Codex Radio TV (v${version}).`,
                    detail: "¿Desea descargarla ahora? La instalación se completará al cerrar la aplicación.",
                    buttons: ["Descargar", "Después"],
                    defaultId: 0,
                    cancelId: 1,
                })
                .then((result) => {
                    if (result.response === 0) {
                        autoUpdater.downloadUpdate();
                    }
                });
        });

        autoUpdater.on("update-not-available", () => {
            console.log("[auto-update] No hay actualizaciones disponibles.");
        });

        autoUpdater.on("download-progress", (progress) => {
            const pct = Math.round(progress.percent || 0);
            console.log(`[auto-update] Descargando: ${pct}%`);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setProgressBar(pct / 100);
            }
        });

        autoUpdater.on("update-downloaded", () => {
            console.log("[auto-update] Descarga completa.");
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.setProgressBar(-1);
            }
            dialog
                .showMessageBox(mainWindow, {
                    type: "info",
                    title: "Actualización lista",
                    message: "La actualización se descargó correctamente.",
                    detail: "Se instalará automáticamente al cerrar la aplicación, o puede reiniciar ahora.",
                    buttons: ["Reiniciar ahora", "Al cerrar"],
                    defaultId: 0,
                    cancelId: 1,
                })
                .then((result) => {
                    if (result.response === 0) {
                        autoUpdater.quitAndInstall();
                    }
                });
        });

        autoUpdater.on("error", (err) => {
            console.error("[auto-update] Error:", err.message || err);
        });

        setTimeout(() => {
            console.log("[auto-update] Verificando actualizaciones...");
            autoUpdater.checkForUpdates().catch((err) => {
                console.error("[auto-update] No se pudo verificar:", err.message || err);
            });
        }, 5000);
    } catch (error) {
        console.error("[auto-update] No se pudo inicializar:", error.message || error);
    }
}

app.whenReady().then(() => {
    createServer();
    setTimeout(createWindow, 600);
    setTimeout(setupAutoUpdater, 3000);
    setTimeout(() => {
        autoUpdateYtDlp().then((r) => {
            if (r.updated) console.log(`[startup] Core actualizado: ${r.oldVersion} -> ${r.newVersion}`);
        }).catch(() => {});
    }, 8000);
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}).catch((err) => {
    console.error("❌ Error al iniciar app:", err);
});

app.on("window-all-closed", () => {
    if (server) server.close();
    if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
    if (server) server.close();
});
