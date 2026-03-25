// ================================================================
//   TicketDesk — Google Apps Script Backend
//   Spreadsheet: LISTKY sheet, cols A–Q
// ================================================================

var SHEET_ID   = '1kkdye31xxseQUoDzxTJswFNGAFlFhpQbXeH1G1sGsys';
var SHEET_NAME = 'LISTKY';
var PASSWORD   = 'JovByHuv1111';

// ── Main entry point ─────────────────────────────────────────────
function doGet(e) {
  var p = (e && e.parameter) ? e.parameter : {};
  var result;
  try {
    switch (p.action) {
      case 'login':        result = { ok: p.password === PASSWORD }; break;
      case 'getDashboard': result = getDashboard();    break;
      case 'getTickets':   result = getTickets();      break;
      case 'addTicket':    result = addTicket(p);      break;
      case 'updateTicket': result = updateTicket(p);   break;
      case 'deleteTicket': result = deleteTicket(p);   break;
      default:             result = { error: 'Unknown action' };
    }
  } catch (err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet helpers ─────────────────────────────────────────────────
function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function readSheet() {
  var data = getSheet().getDataRange().getValues();
  var dataRows = [];
  var totalRowIndex = -1;

  var lastNonEmptySheetRow = 0;

  for (var i = 1; i < data.length; i++) {
    var r   = data[i];
    var raw = String(r[0] || '').trim();
    if (raw === '') continue;

    var currentSheetRow = i + 1;

    // If there is a large gap (>10 rows) since the last non-empty col-A row,
    // we have left the ticket block — treat this as the TOTAL/summary section.
    if (lastNonEmptySheetRow > 0 && (currentSheetRow - lastNonEmptySheetRow) > 10) {
      if (totalRowIndex === -1) totalRowIndex = currentSheetRow;
      break;
    }
    lastNonEmptySheetRow = currentSheetRow;

    var num = parseInt(raw, 10);
    if (!isNaN(num) && num > 0 && String(num) === raw) {
      dataRows.push({ sheetRow: currentSheetRow, data: r });
    } else {
      if (totalRowIndex === -1) totalRowIndex = currentSheetRow;
    }
  }
  return { dataRows: dataRows, totalRowIndex: totalRowIndex };
}

// ── Number cleaner ────────────────────────────────────────────────
function clean(v) {
  if (v === null || v === undefined || v === '') return 0;
  var s = String(v).trim().replace(/[€$£%\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,(?=\d{3})/g, '');
  }
  return parseFloat(s) || 0;
}

function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10)  / 10;  }
function notEmpty(v) { return v !== null && v !== undefined && v !== ''; }

// ================================================================
//   ACTION HANDLERS
// ================================================================

function getDashboard() {
  var dataRows = readSheet().dataRows;
  var totalInvested = 0, totalRevenue = 0, soldInvested = 0;
  var ticketsSold = 0, activeEvents = 0;
  var breakdown = [];

  for (var i = 0; i < dataRows.length; i++) {
    var r      = dataRows[i].data;
    var nakup  = clean(r[8]);   // total invested for this row (already includes qty)
    var predaj = clean(r[9]);   // total revenue for this row
    var ks     = parseInt(r[5], 10) || 1;
    var status = String(r[13] || '').trim();

    totalInvested += nakup;

    var rowProfit = predaj > 0 ? round2(predaj - nakup) : 0;
    var rowRoi    = nakup > 0 && predaj > 0
                    ? round1((predaj - nakup) / nakup * 100) : 0;

    breakdown.push({
      artist:   String(r[1] || ''),
      country:  String(r[2] || ''),
      qty:      ks,
      invested: round2(nakup),
      revenue:  round2(predaj),
      profit:   rowProfit,
      roi:      rowRoi,
      status:   status || (predaj > 0 ? 'SOLD' : 'ACTIVE')
    });

    if (predaj > 0) {
      totalRevenue += predaj;
      ticketsSold  += ks;
      soldInvested += nakup;
    } else {
      activeEvents++;
    }
  }

  var netProfit = totalRevenue - soldInvested;
  var avgRoi    = soldInvested > 0 ? netProfit / soldInvested * 100 : 0;

  return {
    totalInvested: round2(totalInvested),
    totalRevenue:  round2(totalRevenue),
    netProfit:     round2(netProfit),
    avgRoi:        round1(avgRoi),
    ticketsSold:   ticketsSold,
    activeEvents:  activeEvents,
    breakdown:     breakdown
  };
}

function getTickets() {
  var dataRows = readSheet().dataRows;
  var tickets = dataRows.map(function(row) {
    var r = row.data;
    return {
      rowIndex:  row.sheetRow,
      num:       r[0],
      artist:    String(r[1]  || ''),
      country:   String(r[2]  || ''),
      date:      String(r[3]  || ''),
      section:   String(r[4]  || ''),
      qty:       r[5]  || '',
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
      paid:      String(r[16] || '')
    };
  });
  return { tickets: tickets };
}

function addTicket(p) {
  var res       = readSheet();
  var dataRows  = res.dataRows;
  var buyPrice  = parseFloat(p.buyPrice)  || 0;
  var sellPrice = parseFloat(p.sellPrice) || 0;
  var qty       = parseInt(p.qty, 10)     || 1;
  var profit    = sellPrice > 0 ? round2((sellPrice - buyPrice) * qty) : '';
  var roi       = sellPrice > 0 && buyPrice > 0
                  ? round1((sellPrice - buyPrice) / buyPrice * 100) + '%' : '';

  var newNum = dataRows.length + 1;
  var newRow = [
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
    p.paid     || ''
  ];

  var sheet = getSheet();
  // Insert directly after the last real ticket row
  var res2     = readSheet();
  var insertAt = res2.dataRows.length > 0
    ? res2.dataRows[res2.dataRows.length - 1].sheetRow
    : 1;

  sheet.insertRowAfter(insertAt);
  var targetRow = insertAt + 1;
  sheet.getRange(targetRow, 1, 1, newRow.length).setValues([newRow]);

  return { ok: true, row: targetRow };
}

function updateTicket(p) {
  var rowIndex  = parseInt(p.rowIndex, 10);
  var buyPrice  = parseFloat(p.buyPrice)  || 0;
  var sellPrice = parseFloat(p.sellPrice) || 0;
  var qty       = parseInt(p.qty, 10)     || 1;
  var profit    = sellPrice > 0 ? round2((sellPrice - buyPrice) * qty) : '';
  var roi       = sellPrice > 0 && buyPrice > 0
                  ? round1((sellPrice - buyPrice) / buyPrice * 100) + '%' : '';

  var updates = [
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
    p.paid     || ''
  ];

  getSheet().getRange(rowIndex, 2, 1, updates.length).setValues([updates]);
  return { ok: true };
}

function deleteTicket(p) {
  var rowIndex = parseInt(p.rowIndex, 10);
  getSheet().deleteRow(rowIndex);
  return { ok: true };
}
