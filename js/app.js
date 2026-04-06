
// app.js - Main logic for BMS Result Logger (Serverless)

let dbScore = null;
let dbScoreLog = null;
let dbSong = null;

// Store processed data for sharing
let currentShareData = null;

// Initialize SQL.js
let SQL = null;
const sqlPromise = initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
}).then(module => {
    SQL = module;
    console.log("SQL.js loaded");
    // Check for shared URL hash first
    if (!tryRestoreFromHash()) {
        checkLoadButton();
    }
});

// DOM Elements
// DOM Elements
const fileInputScore = document.getElementById('score-db');
const fileInputScoreLog = document.getElementById('scorelog-db');
const loadBtn = document.getElementById('load-btn');
// const loadingMsg = document.getElementById('loading-msg'); // Removed
const uploadSection = document.getElementById('upload-section');
const dashboard = document.getElementById('dashboard');
const currentDateEl = document.getElementById('current-date');

// Set current date
const now = new Date();
const todayDateStr = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\./g, '-').replace(/\s/g, '').slice(0, 10); // YYYY-MM-DD
currentDateEl.innerText = todayDateStr;

// Enable Load Button when files are selected
function checkLoadButton() {
    if (fileInputScore.files.length > 0 && fileInputScoreLog.files.length > 0 && SQL) {
        loadBtn.disabled = false;
    } else {
        loadBtn.disabled = true;
    }
}

fileInputScore.addEventListener('change', checkLoadButton);
fileInputScoreLog.addEventListener('change', checkLoadButton);

loadBtn.addEventListener('click', async () => {
    loadBtn.disabled = true;
    const originalText = loadBtn.innerText;
    loadBtn.innerText = "분석 중..."; // Loading...

    try {
        await loadDatabases();
        processData();
        uploadSection.style.display = 'none';
        dashboard.style.display = 'block';
    } catch (err) {
        console.error(err);
        alert("데이터 로드 중 오류가 발생했습니다: " + err.message);
        loadBtn.disabled = false;
        loadBtn.innerText = originalText;
    }
});

async function loadDatabases() {
    // 1. Load song.db (Static Asset)
    try {
        const response = await fetch('data/song.db');
        if (!response.ok) throw new Error("song.db fetch failed");
        const songBuffer = await response.arrayBuffer();
        dbSong = new SQL.Database(new Uint8Array(songBuffer));
        console.log("song.db loaded");
    } catch (e) {
        console.warn("song.db failed to load (local testing?):", e);
        // Fallback or ignore
    }

    // 2. Load User Files
    const scoreFile = fileInputScore.files[0];
    const scoreLogFile = fileInputScoreLog.files[0];

    dbScore = await loadDbFromFile(scoreFile);
    dbScoreLog = await loadDbFromFile(scoreLogFile);

    console.log("User DBs loaded");
}

function loadDbFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const u8 = new Uint8Array(reader.result);
                const db = new SQL.Database(u8);
                resolve(db);
            } catch (e) {
                reject(e);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
    });
}

function getClearString(clearCode) {
    const map = {
        0: 'NO PLAY',
        1: 'FAILED',
        2: 'ASSIST EASY',
        3: 'LIGHT ASSIST',
        4: 'EASY',
        5: 'NORMAL',
        6: 'HARD',
        7: 'EX HARD',
        8: 'FULLCOMBO',
        9: 'PERFECT',
        10: 'MAX'
    };
    return map[clearCode] || 'UNKNOWN';
}

function processData() {
    // 1. Get Summary (Today's clears/fails)
    // User requested to use 'player' table in score.db
    // player table schema: date, playcount, clear, ...

    // todayStart is 00:00:00 of today in local time (seconds)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;

    let summary = { playcount: 0, clears: 0, fails: 0, notes: 0 };

    try {
        const timings = "epg, lpg, egr, lgr, egd, lgd, ebd, lbd, epr, lpr";

        // Fetch Today's Record
        const todayRes = dbScore.exec(`
            SELECT playcount, clear, ${timings}
            FROM player 
            WHERE date = ${todayStart}
        `);

        // Fetch Previous Record
        const prevRes = dbScore.exec(`
            SELECT playcount, clear, ${timings}
            FROM player 
            WHERE date < ${todayStart}
            ORDER BY date DESC
            LIMIT 1
        `);

        if (todayRes.length > 0 && todayRes[0].values.length > 0) {
            const todayRow = todayRes[0].values[0];
            let todayPlay = todayRow[0] || 0;
            let todayClear = todayRow[1] || 0;
            // Sum indices 2 to 11 (10 columns)
            let todayNotes = 0;
            for (let i = 2; i <= 11; i++) todayNotes += (todayRow[i] || 0);

            if (prevRes.length > 0 && prevRes[0].values.length > 0) {
                const prevRow = prevRes[0].values[0];
                const prevPlay = prevRow[0] || 0;
                const prevClear = prevRow[1] || 0;
                let prevNotes = 0;
                for (let i = 2; i <= 11; i++) prevNotes += (prevRow[i] || 0);

                // Calculate Diff
                summary.playcount = todayPlay - prevPlay;
                summary.clears = todayClear - prevClear;
                summary.notes = todayNotes - prevNotes;
            } else {
                // No previous record
                summary.playcount = todayPlay;
                summary.clears = todayClear;
                summary.notes = todayNotes;
            }
            summary.fails = summary.playcount - summary.clears;
        } else {
            console.log("No player record for today in score.db (yet).");
        }
    } catch (e) {
        console.warn("Failed to query player table:", e);
        // Fallback or keep 0
    }

    document.getElementById('stat-playcount').innerText = summary.playcount;
    document.getElementById('stat-clear').innerText = summary.clears;
    document.getElementById('stat-fail').innerText = summary.fails;
    document.getElementById('stat-notes').innerText = summary.notes.toLocaleString();

    // 2. Get Detailed Plays
    const playsRes = dbScoreLog.exec(`
        SELECT sha256, date, score, clear, oldscore, oldclear, combo, oldcombo, minbp, oldminbp 
        FROM scorelog 
        WHERE date >= ${todayStart} AND clear != 1
        ORDER BY date DESC
    `);

    const tbody = document.getElementById('result-tbody');
    tbody.innerHTML = '';

    // Initialize share data
    currentShareData = {
        d: todayDateStr,
        s: { p: summary.playcount, c: summary.clears, f: summary.fails, n: summary.notes },
        r: []
    };

    if (playsRes.length === 0 || playsRes[0].values.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="no-data">오늘 성과가 없어요 ㅠㅠ 잘 좀 해봐요</td>';
        tbody.appendChild(tr);
        return;
    }

    const rows = playsRes[0].values;
    rows.forEach(row => {
        const sha256 = row[0];
        const date = row[1];
        const score = row[2];
        const clear = row[3];
        const oldScore = row[4];
        const oldClear = row[5];
        const combo = row[6];
        const oldCombo = row[7];
        const minBp = row[8];
        const oldMinBp = row[9];

        const timeStr = new Date(date * 1000).toTimeString().split(' ')[0]; // HH:MM:SS
        const clearStr = getClearString(clear);

        // Render Row - No row-level color class
        const tr = document.createElement('tr');

        // Variation Logic (Detailed)
        let changes = [];
        let shareChanges = []; // For share data (text-only)

        // Score (Only if changed)
        const scoreDiff = score - oldScore;
        if (scoreDiff !== 0) {
            let scoreHtml = `Score: ${oldScore} → <b>${score}</b>`;
            if (scoreDiff > 0) scoreHtml += ` <span class="diff plus">(+${scoreDiff})</span>`;
            else scoreHtml += ` <span class="diff minus">(${scoreDiff})</span>`;
            changes.push(scoreHtml);
            shareChanges.push(`Score: ${oldScore} \u2192 ${score} (${scoreDiff > 0 ? '+' : ''}${scoreDiff})`);
        }

        // Clear Lamp (Only if changed)
        if (clear !== oldClear) {
            const oldClearStr = getClearString(oldClear);
            let clearHtml = `Clear: ${oldClearStr} → <b class="text-clear-${clear}">${clearStr}</b>`;
            changes.push(clearHtml);
            shareChanges.push(`Clear: ${oldClearStr} \u2192 ${clearStr}`);
        }

        // BP (Only if changed)
        if (oldMinBp !== 2147483647 && minBp !== oldMinBp) {
            const bpDiff = minBp - oldMinBp;
            let bpHtml = `BP: ${oldMinBp} → <b>${minBp}</b>`;
            if (bpDiff < 0) bpHtml += ` <span class="diff plus">(${bpDiff})</span>`; // Better
            else if (bpDiff > 0) bpHtml += ` <span class="diff minus">(+${bpDiff})</span>`; // Worse
            changes.push(bpHtml);
            shareChanges.push(`BP: ${oldMinBp} \u2192 ${minBp} (${bpDiff > 0 ? '+' : ''}${bpDiff})`);
        }

        // Combo (Only if improved)
        if (combo > oldCombo) {
            const comboDiff = combo - oldCombo;
            changes.push(`Combo: ${oldCombo} \u2192 <b>${combo}</b> <span class="diff plus">(+${comboDiff})</span>`);
            shareChanges.push(`Combo: ${oldCombo} \u2192 ${combo} (+${comboDiff})`);
        }

        // Fallback if nothing is pushed (Shouldn't happen if it's in scorelog, but just in case)
        if (changes.length === 0) {
            // Check if it's just a new play without improvements?
            // Scorelog usually stores improvements. If score didn't change, maybe it matched?
            // If completely identical, maybe show "No significant update"?
            // Or maybe just show Score?
            changes.push(`Score: ${score}`);
            changes.push(`Clear: <b class="text-clear-${clear}">${clearStr}</b>`);
            shareChanges.push(`Score: ${score}`);
            shareChanges.push(`Clear: ${clearStr}`);
        }

        let diffHtml = changes.join('<br>');


        let title = sha256.substring(0, 8) + "...";
        let difficulty = "-";

        // Resolve Song Info
        if (dbSong) {
            try {
                const songRes = dbSong.exec(`SELECT title, subtitle, "table", level FROM song WHERE sha256 = '${sha256}'`);
                if (songRes.length > 0 && songRes[0].values.length > 0) {
                    const sRow = songRes[0].values[0];
                    let sTitle = sRow[0];
                    const sSubtitle = sRow[1];
                    const sTable = sRow[2];
                    const sLevel = sRow[3];

                    if (sSubtitle && sSubtitle.trim()) {
                        sTitle += " " + sSubtitle.trim();
                    }
                    title = sTitle;

                    if (sTable) {
                        difficulty = sTable + sLevel;
                    }
                }
            } catch (e) {
                console.warn("Song query error", e);
            }
        }

        // Store in share data
        currentShareData.r.push({
            t: title,
            df: difficulty,
            ch: shareChanges
        });

        // Render Row
        tr.innerHTML = `
            <td>${timeStr}</td>
            <td class="song-title"><span title="${sha256}">${title}</span></td>
            <td>${difficulty}</td>
            <td class="diff-cell" style="text-align: left;">${diffHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}


// ==================== Share Feature ====================

const SHARE_BASE_URL = 'https://sonohoshi.github.io/gosubms/';
const MAX_URL_LENGTH = 2000;

// --- Encode / Decode ---

function encodeShareData(data) {
    const json = JSON.stringify(data);
    const compressed = pako.deflate(json);
    let binary = '';
    for (let i = 0; i < compressed.length; i++) {
        binary += String.fromCharCode(compressed[i]);
    }
    const base64 = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return base64;
}

function decodeShareData(hash) {
    try {
        let base64 = hash.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4 !== 0) base64 += '=';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const json = pako.inflate(bytes, { to: 'string' });
        return JSON.parse(json);
    } catch (e) {
        console.error('Failed to decode share data:', e);
        return null;
    }
}

// --- Generate Share URL ---

function generateShareUrl(data) {
    const encoded = encodeShareData(data);
    const url = SHARE_BASE_URL + '#' + encoded;
    if (url.length > MAX_URL_LENGTH) {
        return { url: null, error: 'URL\uC774 \uB108\uBB34 \uAE41\uB2C8\uB2E4 (' + url.length + '\uC790). \uAE30\uB85D\uC774 \uB9CE\uC544 URL \uACF5\uC720\uAC00 \uBD88\uAC00\uB2A5\uD569\uB2C8\uB2E4.' };
    }
    return { url: url, error: null };
}

// --- Generate Share Text ---

function generateShareText(data, shareUrl) {
    var s = data.s;
    var lines = [];
    lines.push('\uD83C\uDFAE \uACE0\uC218\uBE0C\uBBC0\uC2A4 ' + data.d + ' \uC131\uACFC');
    lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
    lines.push('\u25B6 ' + s.p + '\uD68C \uD50C\uB808\uC774 | \u2705 ' + s.c + ' \uD074\uB9AC\uC5B4 | \u274C ' + s.f + ' \uC2E4\uD328');
    lines.push('\uD83C\uDFB5 \uCC98\uB9AC\uD55C \uB178\uD2B8: ' + s.n.toLocaleString() + '\uAC1C');

    if (data.r && data.r.length > 0) {
        lines.push('');
        lines.push('\uD83D\uDCDC \uAE30\uB85D \uAC31\uC2E0 (' + data.r.length + '\uAC74)');
        var maxShow = 5;
        var shown = data.r.slice(0, maxShow);
        for (var i = 0; i < shown.length; i++) {
            var record = shown[i];
            var line = '\u2022 ' + record.t;
            if (record.df && record.df !== '-') line += ' [' + record.df + ']';
            lines.push(line);
            for (var j = 0; j < record.ch.length; j++) {
                lines.push('  ' + record.ch[j]);
            }
        }
        if (data.r.length > maxShow) {
            lines.push('  ...\uC678 ' + (data.r.length - maxShow) + '\uAC74');
        }
    }

    if (shareUrl) {
        lines.push('');
        lines.push(shareUrl);
    }

    return lines.join('\n');
}

// --- Image Capture ---

async function captureImage() {
    const dashboardEl = document.getElementById('dashboard');
    const canvas = await html2canvas(dashboardEl, {
        backgroundColor: '#121212',
        scale: 2,
        useCORS: true,
        logging: false,
        ignoreElements: function(el) { return el.classList.contains('share-btn-container'); }
    });
    return canvas;
}

// --- Toast Notification ---

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function() {
        toast.classList.add('show');
    });

    setTimeout(function() {
        toast.classList.remove('show');
        setTimeout(function() { toast.remove(); }, 300);
    }, 2000);
}

// --- Copy feedback ---

function flashCopySuccess(btn) {
    const original = btn.innerHTML;
    btn.classList.add('copy-success');
    btn.innerHTML = '<i class="fas fa-check"></i> \uBCF5\uC0AC\uB428!';
    setTimeout(function() {
        btn.classList.remove('copy-success');
        btn.innerHTML = original;
    }, 1500);
}

// --- Modal Control ---

function openShareModal() {
    if (!currentShareData) return;

    const modal = document.getElementById('share-modal');
    const shareCanvas = document.getElementById('share-canvas');
    const loadingEl = document.getElementById('share-image-loading');
    const copyImageBtn = document.getElementById('copy-image-btn');
    const downloadImageBtn = document.getElementById('download-image-btn');
    const shareUrlInput = document.getElementById('share-url');
    const shareUrlError = document.getElementById('share-url-error');
    const shareTextArea = document.getElementById('share-text');

    // Reset state
    shareCanvas.style.display = 'none';
    loadingEl.style.display = 'flex';
    copyImageBtn.disabled = true;
    downloadImageBtn.disabled = true;

    // Show modal
    modal.style.display = 'flex';

    // Generate URL
    const result = generateShareUrl(currentShareData);
    if (result.error) {
        shareUrlInput.value = '';
        shareUrlInput.placeholder = 'URL \uC0DD\uC131 \uBD88\uAC00';
        shareUrlError.textContent = result.error;
        shareUrlError.style.display = 'block';
    } else {
        shareUrlInput.value = result.url;
        shareUrlError.style.display = 'none';
    }

    // Generate share text
    shareTextArea.value = generateShareText(currentShareData, result.url);

    // Capture image (async)
    captureImage().then(function(canvas) {
        loadingEl.style.display = 'none';
        shareCanvas.width = canvas.width;
        shareCanvas.height = canvas.height;
        const ctx = shareCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        shareCanvas.style.display = 'block';
        copyImageBtn.disabled = false;
        downloadImageBtn.disabled = false;
    }).catch(function(err) {
        console.error('Image capture failed:', err);
        loadingEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> \uC774\uBBF8\uC9C0 \uC0DD\uC131 \uC2E4\uD328';
    });
}

function closeShareModal() {
    document.getElementById('share-modal').style.display = 'none';
}

// --- URL Hash Restoration ---

function tryRestoreFromHash() {
    const hash = window.location.hash.slice(1);
    if (!hash) return false;

    const data = decodeShareData(hash);
    if (!data) return false;

    renderSharedView(data);
    return true;
}

function renderSharedView(data) {
    document.getElementById('upload-section').style.display = 'none';
    document.getElementById('dashboard').style.display = 'none';

    const sharedView = document.getElementById('shared-view');
    sharedView.style.display = 'block';

    document.getElementById('shared-date').textContent = '\uD83D\uDCC5 ' + data.d;

    const statsGrid = document.getElementById('shared-stats-grid');
    const s = data.s;
    statsGrid.innerHTML = 
        '<div class="stat-card">' +
            '<div class="stat-icon play"><i class="fas fa-play"></i></div>' +
            '<div class="stat-info"><h3>\uD50C\uB808\uC774 \uD69F\uC218</h3><p class="stat-value">' + s.p + '</p></div>' +
        '</div>' +
        '<div class="stat-card">' +
            '<div class="stat-icon clear"><i class="fas fa-check"></i></div>' +
            '<div class="stat-info"><h3>\uD074\uB9AC\uC5B4</h3><p class="stat-value text-clear-best">' + s.c + '</p></div>' +
        '</div>' +
        '<div class="stat-card">' +
            '<div class="stat-icon fail"><i class="fas fa-times"></i></div>' +
            '<div class="stat-info"><h3>\uC2E4\uD328</h3><p class="stat-value text-clear-1">' + s.f + '</p></div>' +
        '</div>' +
        '<div class="stat-card">' +
            '<div class="stat-icon note"><i class="fas fa-music"></i></div>' +
            '<div class="stat-info"><h3>\uCC98\uB9AC\uD55C \uB178\uD2B8 \uC218</h3><p class="stat-value">' + s.n.toLocaleString() + '</p></div>' +
        '</div>';

    const tbody = document.getElementById('shared-result-tbody');
    tbody.innerHTML = '';

    if (!data.r || data.r.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="3" class="no-data">\uAE30\uB85D \uAC31\uC2E0 \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.</td>';
        tbody.appendChild(tr);
        return;
    }

    data.r.forEach(function(record) {
        const tr = document.createElement('tr');
        const changesHtml = record.ch.map(function(ch) {
            let colored = ch;
            colored = colored.replace(/\((\+[^)]+)\)/g, '<span class="diff plus">($1)</span>');
            colored = colored.replace(/\((-[^)]+)\)/g, '<span class="diff minus">($1)</span>');
            const clearNames = ['EX HARD', 'HARD', 'FULLCOMBO', 'PERFECT', 'MAX', 'NORMAL', 'EASY', 'LIGHT ASSIST', 'ASSIST EASY'];
            clearNames.forEach(function(name) {
                const arrowRegex = new RegExp('\u2192 (' + name + ')', 'g');
                colored = colored.replace(arrowRegex, '\u2192 <b>' + name + '</b>');
            });
            return colored;
        }).join('<br>');

        tr.innerHTML =
            '<td class="song-title">' + record.t + '</td>' +
            '<td>' + record.df + '</td>' +
            '<td class="diff-cell" style="text-align: left;">' + changesHtml + '</td>';
        tbody.appendChild(tr);
    });
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', function() {
    // Share button
    var shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', openShareModal);
    }

    // Modal close
    var closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeShareModal);
    }

    // Click outside modal to close
    var modal = document.getElementById('share-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) closeShareModal();
        });
    }

    // ESC to close
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeShareModal();
    });

    // Copy image
    var copyImageBtn = document.getElementById('copy-image-btn');
    if (copyImageBtn) {
        copyImageBtn.addEventListener('click', async function() {
            var canvas = document.getElementById('share-canvas');
            try {
                var blob = await new Promise(function(resolve) { canvas.toBlob(resolve, 'image/png'); });
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                flashCopySuccess(copyImageBtn);
                showToast('\uC774\uBBF8\uC9C0\uAC00 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!');
            } catch (err) {
                console.error('Copy image failed:', err);
                showToast('\uC774\uBBF8\uC9C0 \uBCF5\uC0AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uBE0C\uB77C\uC6B0\uC800 \uAD8C\uD55C\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694.');
            }
        });
    }

    // Download image
    var downloadImageBtn = document.getElementById('download-image-btn');
    if (downloadImageBtn) {
        downloadImageBtn.addEventListener('click', function() {
            var canvas = document.getElementById('share-canvas');
            var link = document.createElement('a');
            link.download = 'gosubms_' + todayDateStr + '.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('\uC774\uBBF8\uC9C0\uAC00 \uC800\uC7A5\uB418\uC5C8\uC2B5\uB2C8\uB2E4!');
        });
    }

    // Copy URL
    var copyUrlBtn = document.getElementById('copy-url-btn');
    if (copyUrlBtn) {
        copyUrlBtn.addEventListener('click', async function() {
            var urlInput = document.getElementById('share-url');
            if (!urlInput.value) return;
            try {
                await navigator.clipboard.writeText(urlInput.value);
                flashCopySuccess(copyUrlBtn);
                showToast('URL\uC774 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!');
            } catch (err) {
                urlInput.select();
                document.execCommand('copy');
                showToast('URL\uC774 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!');
            }
        });
    }

    // Copy text
    var copyTextBtn = document.getElementById('copy-text-btn');
    if (copyTextBtn) {
        copyTextBtn.addEventListener('click', async function() {
            var textArea = document.getElementById('share-text');
            try {
                await navigator.clipboard.writeText(textArea.value);
                flashCopySuccess(copyTextBtn);
                showToast('\uBA54\uC2DC\uC9C0\uAC00 \uD074\uB9BD\uBCF4\uB4DC\uC5D0 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!');
            } catch (err) {
                textArea.select();
                document.execCommand('copy');
                showToast('\uBA54\uC2DC\uC9C0\uAC00 \uBCF5\uC0AC\uB418\uC5C8\uC2B5\uB2C8\uB2E4!');
            }
        });
    }
});
