require('dotenv').config();
const express    = require('express');
const { google } = require('googleapis');
const path       = require('path');

const app = express();

const SHEET_ID   = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'LISTKY';
const KEY_FILE   = process.env.GOOGLE_KEY_FILE;
const PORT       = parseInt(process.env.PORT) || 3000;
const PASSWORD   = process.env.PASSWORD;

// ── Google Auth ──────────────────────────────────────────────────
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function sheetsApi() {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Number cleaner (matches existing sheet number formats) ───────
function clean(v) {
  if (v === null || v === undefined || v === '') return 0;
  let s = String(v).trim().replace(/[€$£%\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,(?=\d{3})/g, '');
  }
  return parseFloat(s) || 0;
}

// ── Read all rows from sheet ─────────────────────────────────────
// Returns:
//   dataRows    — ticket rows (col A is a positive integer)
//   totalRowIndex — 1-indexed sheet row of the TOTAL/summary row, or -1
async function readSheet() {
  const api = await sheetsApi();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:Q`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values || [];
  const dataRows     = [];
  let totalRowIndex  = -1;

  for (let i = 1; i < rows.length; i++) {          // skip header (i=0)
    const r   = rows[i] || [];
    const raw = String(r[0] ?? '').trim();
    if (raw === '') continue;

    const num = parseInt(raw, 10);
    if (!isNaN(num) && num > 0 && String(num) === raw) {
      // Genuine ticket row — col A is a plain positive integer
      dataRows.push({ sheetRow: i + 1, data: r }); // sheetRow = 1-indexed
    } else {
      // TOTAL / summary / formula row — remember its position
      if (totalRowIndex === -1) totalRowIndex = i + 1;
    }
  }

  return { dataRows, totalRowIndex };
}

// ── Get sheet metadata (sheetId for batchUpdate) ─────────────────
async function getSheetId(api) {
  const res = await api.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = res.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found`);
  return sheet.properties.sheetId;
}

// ================================================================
//   ACTION HANDLERS
// ================================================================

function getDashboard(dataRows) {
  let totalInvested = 0, totalRevenue = 0, soldInvested = 0;
  let ticketsSold = 0, activeEvents = 0;
  const breakdown = [];

  for (const { data: r } of dataRows) {
    const nakup  = clean(r[8]);
    const predaj = clean(r[9]);
    const ks     = parseInt(r[5], 10) || 0;
    const status = String(r[13] || '').trim();

    totalInvested += nakup;

    const rowProfit = predaj > 0 ? round2(predaj - nakup) : 0;
    const rowRoi    = nakup > 0 && predaj > 0
                      ? round1((predaj - nakup) / nakup * 100)
                      : 0;

    breakdown.push({
      artist:   String(r[1] || ''),
      country:  String(r[2] || ''),
      qty:      ks,
      invested: round2(nakup),
      revenue:  round2(predaj),
      profit:   rowProfit,
      roi:      rowRoi,
      status:   status || (predaj > 0 ? 'SOLD' : 'ACTIVE'),
    });

    if (predaj > 0) {
      totalRevenue += predaj;
      ticketsSold  += ks;
      soldInvested += nakup;
    } else {
      activeEvents++;
    }
  }

  const netProfit = totalRevenue - soldInvested;
  const avgRoi    = soldInvested > 0 ? netProfit / soldInvested * 100 : 0;

  return {
    totalInvested: round2(totalInvested),
    totalRevenue:  round2(totalRevenue),
    netProfit:     round2(netProfit),
    avgRoi:        round1(avgRoi),
    ticketsSold,
    activeEvents,
    breakdown,
  };
}

function getTickets(dataRows) {
  return {
    tickets: dataRows.map(({ sheetRow, data: r }) => ({
      rowIndex:  sheetRow,
      num:       r[0],
      artist:    String(r[1]  || ''),
      country:   String(r[2]  || ''),
      date:      String(r[3]  || ''),
      section:   String(r[4]  || ''),
      qty:       r[5]  ?? '',
      boughtAt:  String(r[6]  || ''),
      account:   String(r[7]  || ''),
      buyPrice:  clean(r[8]),
      sellPrice: notEmpty(r[9])  ? clean(r[9])  : '',
      profit:    notEmpty(r[10]) ? clean(r[10]) : '',
      roi:       String(r[11] || ''),
      soldAt:    String(r[12] || ''),
      status:    String(r[13] || ''),
      listed:    String(r[14] || ''),
      notes:     String(r[15] || ''),
      paid:      String(r[16] || ''),
    })),
  };
}

async function addTicket(p) {
  const api = await sheetsApi();
  const { dataRows, totalRowIndex } = await readSheet();

  const buyPrice  = parseFloat(p.buyPrice)  || 0;
  const sellPrice = parseFloat(p.sellPrice) || 0;
  const qty       = parseInt(p.qty, 10)     || 1;
  const profit    = sellPrice > 0 ? round2(sellPrice - buyPrice) : '';
  const roi       = sellPrice > 0 && buyPrice > 0
                    ? round1((sellPrice - buyPrice) / buyPrice * 100) + '%'
                    : '';

  const newNum = dataRows.length + 1;
  const newRow = [
    newNum,
    p.artist   || '',
    p.country  || '',
    p.date     || '',
    p.section  || '',
    qty,
    p.boughtAt || '',
    p.account  || '',
    buyPrice,
    sellPrice  || '',
    profit,
    roi,
    p.soldAt   || '',
    p.status   || '',
    p.listed   || '',
    p.notes    || '',
    p.paid     || '',
  ];

  let targetRow;

  if (totalRowIndex > 0) {
    // Insert a blank row just before the TOTAL row so its formulas expand
    const sheetId = await getSheetId(api);
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{
          insertDimension: {
            range: {
              sheetId,
              dimension:  'ROWS',
              startIndex: totalRowIndex - 1,  // 0-indexed
              endIndex:   totalRowIndex,
            },
            inheritFromBefore: true,
          },
        }],
      },
    });
    targetRow = totalRowIndex;  // the newly inserted row
  } else {
    // No TOTAL row — append after last data row
    const last = dataRows.length > 0
                 ? dataRows[dataRows.length - 1].sheetRow
                 : 1;
    targetRow = last + 1;
  }

  await api.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [newRow] },
  });

  return { ok: true, row: targetRow };
}

async function updateTicket(p) {
  const api       = await sheetsApi();
  const rowIndex  = parseInt(p.rowIndex, 10);
  const buyPrice  = parseFloat(p.buyPrice)  || 0;
  const sellPrice = parseFloat(p.sellPrice) || 0;
  const profit    = sellPrice > 0 ? round2(sellPrice - buyPrice) : '';
  const roi       = sellPrice > 0 && buyPrice > 0
                    ? round1((sellPrice - buyPrice) / buyPrice * 100) + '%'
                    : '';

  const updates = [
    p.artist   || '',
    p.country  || '',
    p.date     || '',
    p.section  || '',
    parseInt(p.qty, 10) || 1,
    p.boughtAt || '',
    p.account  || '',
    buyPrice,
    sellPrice  || '',
    profit,
    roi,
    p.soldAt   || '',
    p.status   || '',
    p.listed   || '',
    p.notes    || '',
    p.paid     || '',
  ];

  await api.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!B${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [updates] },
  });

  return { ok: true };
}

async function deleteTicket(p) {
  const api      = await sheetsApi();
  const rowIndex = parseInt(p.rowIndex, 10);
  const sheetId  = await getSheetId(api);

  await api.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension:  'ROWS',
            startIndex: rowIndex - 1,   // 0-indexed
            endIndex:   rowIndex,
          },
        },
      }],
    },
  });

  return { ok: true };
}

// ================================================================
//   API ROUTE  GET /api?action=...
// ================================================================
app.get('/api', async (req, res) => {
  const p = req.query;
  try {
    let result;
    switch (p.action) {
      case 'login': {
        result = { ok: p.password === PASSWORD };
        break;
      }
      case 'getDashboard': {
        const { dataRows } = await readSheet();
        result = getDashboard(dataRows);
        break;
      }
      case 'getTickets': {
        const { dataRows } = await readSheet();
        result = getTickets(dataRows);
        break;
      }
      case 'addTicket':    result = await addTicket(p);    break;
      case 'updateTicket': result = await updateTicket(p); break;
      case 'deleteTicket': result = await deleteTicket(p); break;
      default:             result = { error: 'Unknown action' };
    }
    res.json(result);
  } catch (err) {
    console.error('[API]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ──────────────────────────────────────────────────────
function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10)  / 10;  }
function notEmpty(v) { return v !== null && v !== undefined && v !== ''; }

// ================================================================
app.listen(PORT, () => {
  console.log(`\n  TicketDesk running →  http://localhost:${PORT}\n`);
});
