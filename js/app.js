
// app.js - Main logic for BMS Result Logger (Serverless)

let dbScore = null;
let dbScoreLog = null;
let dbSong = null;

// Initialize SQL.js
let SQL = null;
const sqlPromise = initSqlJs({
    locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
}).then(module => {
    SQL = module;
    console.log("SQL.js loaded");
    checkLoadButton();
});

// DOM Elements
const fileInputScore = document.getElementById('score-db');
const fileInputScoreLog = document.getElementById('scorelog-db');
const loadBtn = document.getElementById('load-btn');
const loadingMsg = document.getElementById('loading-msg');
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
    loadingMsg.style.display = 'block';

    try {
        await loadDatabases();
        processData();
        uploadSection.style.display = 'none';
        dashboard.style.display = 'block';
    } catch (err) {
        console.error(err);
        alert("데이터 로드 중 오류가 발생했습니다: " + err.message);
        loadBtn.disabled = false;
        loadingMsg.style.display = 'none';
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
    // In Python: 
    // today_start = int(datetime.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;

    const res = dbScoreLog.exec(`
        SELECT 
            COUNT(*) as playcount,
            SUM(CASE WHEN clear >= 2 THEN 1 ELSE 0 END) as clears,
            SUM(CASE WHEN clear = 1 THEN 1 ELSE 0 END) as fails
        FROM scorelog 
        WHERE date >= ${todayStart}
    `);

    let summary = { playcount: 0, clears: 0, fails: 0 };
    if (res.length > 0 && res[0].values.length > 0) {
        const row = res[0].values[0];
        summary.playcount = row[0] || 0;
        summary.clears = row[1] || 0;
        summary.fails = row[2] || 0;
    }

    document.getElementById('val-playcount').innerText = summary.playcount;
    document.getElementById('val-clears').innerText = summary.clears;
    document.getElementById('val-fails').innerText = summary.fails;

    // 2. Get Detailed Plays
    const playsRes = dbScoreLog.exec(`
        SELECT sha256, date, score, clear, oldscore, oldclear, combo, oldcombo, minbp, oldminbp 
        FROM scorelog 
        WHERE date >= ${todayStart} AND clear != 1
        ORDER BY date DESC
    `);

    const tbody = document.getElementById('result-tbody');
    tbody.innerHTML = '';

    if (playsRes.length === 0 || playsRes[0].values.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="no-data">오늘 성과가 없어요 ㅠㅠ</td>';
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

        // Score (Only if changed)
        const scoreDiff = score - oldScore;
        if (scoreDiff !== 0) {
            let scoreHtml = `Score: ${oldScore} → <b>${score}</b>`;
            if (scoreDiff > 0) scoreHtml += ` <span class="diff plus">(+${scoreDiff})</span>`;
            else scoreHtml += ` <span class="diff minus">(${scoreDiff})</span>`;
            changes.push(scoreHtml);
        }

        // Clear Lamp (Only if changed)
        if (clear !== oldClear) {
            const oldClearStr = getClearString(oldClear);
            let clearHtml = `Clear: ${oldClearStr} → <b class="text-clear-${clear}">${clearStr}</b>`;
            changes.push(clearHtml);
        }

        // BP (Only if changed)
        if (oldMinBp !== 2147483647 && minBp !== oldMinBp) {
            const bpDiff = minBp - oldMinBp;
            let bpHtml = `BP: ${oldMinBp} → <b>${minBp}</b>`;
            if (bpDiff < 0) bpHtml += ` <span class="diff plus">(${bpDiff})</span>`; // Better
            else if (bpDiff > 0) bpHtml += ` <span class="diff minus">(+${bpDiff})</span>`; // Worse
            changes.push(bpHtml);
        }

        // Combo (Only if improved)
        if (combo > oldCombo) {
            const comboDiff = combo - oldCombo;
            changes.push(`Combo: ${oldCombo} → <b>${combo}</b> <span class="diff plus">(+${comboDiff})</span>`);
        }

        // Fallback if nothing is pushed (Shouldn't happen if it's in scorelog, but just in case)
        if (changes.length === 0) {
            // Check if it's just a new play without improvements?
            // Scorelog usually stores improvements. If score didn't change, maybe it matched?
            // If completely identical, maybe show "No significant update"?
            // Or maybe just show Score?
            changes.push(`Score: ${score}`);
            changes.push(`Clear: <b class="text-clear-${clear}">${clearStr}</b>`);
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
