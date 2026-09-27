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
  var ticketsSold = 0, activeTickets = 0;
  var roiSum = 0, roiCount = 0;
  var groupMap = {};

  for (var i = 0; i < dataRows.length; i++) {
    var r       = dataRows[i].data;
    var artist  = String(r[1] || '').trim();
    var country = String(r[2] || '').trim();
    var nakup   = clean(r[8]);
    var predaj  = clean(r[9]);
    var ks      = parseInt(r[5], 10) || 1;
    var sold    = predaj > 0;

    totalInvested += nakup;
    var rowRoi = sold && nakup > 0 ? round1((predaj - nakup) / nakup * 100) : 0;
    if (sold && nakup > 0) { roiSum += rowRoi; roiCount++; }
    if (sold) {
      totalRevenue += predaj;
      soldInvested += nakup;
      ticketsSold  += ks;
    } else {
      activeTickets += ks;
    }

    var gKey = artist + '|' + country;
    if (!groupMap[gKey]) {
      groupMap[gKey] = {
        artist: artist, country: country,
        qty: 0, soldQty: 0,
        invested: 0, soldInvested: 0,
        revenue: 0, profit: 0
      };
    }
    var g = groupMap[gKey];
    g.qty      += ks;
    g.invested += nakup;
    if (sold) {
      g.soldQty      += ks;
      g.soldInvested += nakup;
      g.revenue      += predaj;
      g.profit       += predaj - nakup;
    }
  }

  var netProfit = round2(totalRevenue - soldInvested);
  var avgRoi    = roiCount > 0 ? round1(roiSum / roiCount) : 0;

  var breakdown = Object.keys(groupMap).map(function(k) {
    var g    = groupMap[k];
    var gRoi = g.soldInvested > 0 ? round1(g.profit / g.soldInvested * 100) : 0;
    var status = g.soldQty === 0    ? 'ACTIVE'
               : g.soldQty >= g.qty ? 'SOLD'
               : 'PARTIAL';
    return {
      artist:   g.artist,
      country:  g.country,
      qty:      g.qty,
      soldQty:  g.soldQty,
      invested: round2(g.invested),
      revenue:  round2(g.revenue),
      profit:   round2(g.profit),
      roi:      gRoi,
      status:   status
    };
  });

  return {
    totalInvested: round2(totalInvested),
    totalRevenue:  round2(totalRevenue),
    netProfit:     netProfit,
    avgRoi:        avgRoi,
    ticketsSold:   ticketsSold,
    activeEvents:  activeTickets,
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
  // buyPrice/sellPrice su TOTALY za cely riadok (uz zahrnaju qty) - nenasobit
  var profit    = sellPrice > 0 ? round2(sellPrice - buyPrice) : '';
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
  // buyPrice/sellPrice su TOTALY za cely riadok (uz zahrnaju qty) - nenasobit
  var profit    = sellPrice > 0 ? round2(sellPrice - buyPrice) : '';
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

// ================================================================
//  ONE-TIME IMPORT — run once from Apps Script editor, then delete
// ================================================================
function runImport() {
  var sheet   = getSheet();
  var all     = sheet.getDataRange().getValues();
  var existing = {};
  var maxNum = 0, lastRow = 1;

  for (var i = 1; i < all.length; i++) {
    var r = all[i], raw = String(r[0]||'').trim();
    if (!raw) continue;
    var n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0 && String(n) === raw) {
      existing[(r[1]+'|'+r[2]+'|'+Math.round(parseFloat(String(r[8]||0))))] = true;
      if (n > maxNum) { maxNum = n; lastRow = i + 1; }
    }
  }

  var EXCEL = [
  ["BST","DE","11 July","Sec O-324 \u2022 Row 1 \u2022 Seats 13 - 16","4","Viagogo","pigment-flakaty-0j@icloud.com","446","1232.8","786.8","176.4%","","SOLD","ANO VI/VG","","ANO"],
  ["BST","UK","Mon, 6 Jul 2026","Sec 323, Row 70,\u00a0Seats\u00a0134\u00a0- 136","3","Viagogo","pigment-flakaty-0j@icloud.com","265.5","989.35","723.85","272.6%","","SOLD","ANO VI/VG","Transered","ANO"],
  ["BST","UK","Tue, 7 Jul 2026","Sec 250, Row 61,\u00a0Seats\u00a089\u00a0- 91","3","Viagogo","pigment-flakaty-0j@icloud.com","265.5","837.14","571.64","215.3%","","SOLD","ANO VI/VG","Transfered","ANO"],
  ["BST","US  NJ","Sat \u2022 Aug 1, 2026 \u2022 8:00 PM","Sec 302, Row 24,\u00a0Seats\u00a019\u00a0- 21","3","Viagogo","pigment-flakaty-0j@icloud.com","214.5","689.97","475.47","221.7%","","SOLD","","Transfered","ANO"],
  ["BST","US  NJ","Sun \u2022 Aug 2, 2026 \u2022 8:00 PM","Sec 303, Row 24,\u00a0Seats\u00a017\u00a0- 19","3","Viagogo","pigment-flakaty-0j@icloud.com","214.5","613.31","398.80999999999995","185.9%","","SOLD","","Transfered (ACCEPTED)","ANO"],
  ["BST","US  LA","Sat \u2022 May 23, 2026\u00a0\u2022 8:00 PM","Sec 412, Row 14,\u00a0Seats\u00a017\u00a0- 20","3","Viagogo","pigment-flakaty-0j@icloud.com","244","612.44","368.44000000000005","151%","","SOLD","","Transfered (ACCEPTED)","ANO"],
  ["BST","US  LA","Sun \u2022 May 24, 2026\u00a0\u2022 8:00 PM","Sec 412, Row 21,\u00a0Seats\u00a09\u00a0- 12","3","Viagogo","pigment-flakaty-0j@icloud.com","244","417.2","173.2","71%","","SOLD","","Transfered","ANO"],
  ["BST","US Ingelwood","Tue \u2022 Sep 1, 2026\u00a0\u2022 8:00 PM","Sec 521, Row 15,\u00a0Seats\u00a012\u00a0- 14","3","Viagogo","pigment-flakaty-0j@icloud.com","223.2","459.5","236.3","105.9%","","SOLD","","","ANO"],
  ["BST","ES","Fri, 26 Jun 2026, 20:00","Sec 500 Row 8 Seat 8-10","3","Viagogo","pigment-flakaty-0j@icloud.com","240","618.3","378.29999999999995","157.6%","","SOLD","ANO VI/VG","","ANO"],
  ["BTS","DE","11 July","333 KERN J Row 13 Seat 22-25","4","Viagogo","cassia.biofuel.2@icloud.com","446","1403.2","957.2","214.6%","","SOLD","ANO VI/VG","","ANO"],
  ["BTS","UK","Tue, 7 Jul 2026   (PREDANE 2KS 534,96 \u20ac)","Sec 501, Row 21,\u00a0Seats\u00a068\u00a0- 71","4","Viagogo","cassia.biofuel.2@icloud.com","586","938.38","352.38","60.1%","","SOLD","ANO VI/VG","","ANO"],
  ["BTS","UK","Mon, 6 Jul 2026","Sec 525, Row 20,\u00a0Seats\u00a0825\u00a0- 827","3","Viagogo","brandonschowalter390@gmx.net","441.04","989.35","548.31","124.3%","","SOLD","ANO VI/VG","Transfered","ANO"],
  ["BTS","CA","Sat \u2022 Aug 22, 2026\u00a0\u2022 8:00 PM","Sec W104, Row 47,\u00a0Seat\u00a028","1","Viagogo","elmofadel122@gmx.net","119.58","287.5","167.92000000000002","140.4%","","SOLD","","Transfered","ANO"],
  ["Bad Bunny","DE","Sun, 21 Jun 2026, 20:00","Sec UM-8 \u2022 Row 19 \u2022 Seats 3 - 7   (May be obstruced)","5","Viagogo","robynstanton599@gmx.net.","671.25","701.6","30.350000000000023","4.5%","","SOLD","VGG","","ANO"],
  ["Bad Bunny","DE","Sun, 21 Jun 2026, 20:00","Sec UM-8 \u2022 Row 3 \u2022 Seats 3 - 7      (May be obstruced)","5","Viagogo","emmycollier381@gmx.net","671.25","727","55.75","8.3%","","SOLD","VGG","","ANO"],
  ["Hilary Duff","UK","Thu, 10 Sept 2026, 18:30","Sec 407, Row Q,\u00a0Seats\u00a0618-620","3","Viagogo","aleneemmerich688@gmx.net","168","0","-168","-100%","","ACTIVE","VGG","","NIE"],
  ["Eagles","USA","Sat \u2022 Apr 11, 2026\u00a0\u2022 8:30 PM","Sec 110, Row 32,\u00a0Seats\u00a09\u00a0- 14","6","Viagogo","aminakunde853@gmx.net   (0489TZ89086U809ZKL)","1538","771.76","-766.24","-49.8%","","SOLD","VI/VGG","Limited view of Sphere screen - Full view of Band and Stage","ANO"],
  ["BSB","USA","Fri, 17 Jul 2026, 8:00 PM","Sec 107, Row 25, Seats 5-12","8","Viagogo","luboasell@gmail.com","1130.46","2157.34","1026.88","90.8%","","SOLD","VI/VGG","Limited view of Sphere screen - Full view of Band and Stage (879,35  3KS)","ANO"],
  ["Metalica","USA","Thu, Feb 25 2027, 8:30 PM","Sec 103, Row 31, Seats 7-8","2","Viagogo","gandalfemail","509.42","900","390.58","76.7%","","SOLD","VI/VGG","Limited view of Sphere screen - Full view of Band and Stage","ANO"],
  ["Bad Bunny","ES","Friday 22/05/2026 20:00","Sec 107, Row 31, Seats 26-30","3","Viagogo","traceykreiger934@gmx.net","750.5","749.82","-0.67999999999995","-0.1%","","SOLD","VGG","","ANO"],
  ["Jay-Z","US","Sun \u2022 Jul 12, 2026 \u2022 8:00 PM","Sec 428, Row 13, Seats 20 - 22","3","Viagogo","anenelleadbdington19@outlook.com","285.2","591.81","306.60999999999996","107.5%","","SOLD","VI/VGG","","ANO"],
  ["Rosalia","ES","1 April","Standing","4","Viagogo","maximillianprohaska482@gmx.net","524","736.68","212.67999999999995","40.6%","","SOLD","VGG","","ANO"],
  ["Rosalia","ES","1 April","Standing","4","Viagogo","olafmraz918@gmx.net","524","771.76","247.76","47.3%","","SOLD","VGG","","ANO"],
  ["Rosalia","ES","1 April","Standing","4","Viagogo","kaciesmith334@gmx.net","524","806.84","282.84000000000003","54%","","SOLD","VGG","","ANO"],
  ["Rosalia","ES-Madrid","17 April","Sec 201, Row 26, Seats 1-5","3","Viagogo","devonteparker588@gmx.net","189.5","407.82","218.32","115.2%","","SOLD","VGG","Limited view","ANO"],
  ["Rosalia","ES-Madrid","17 April","Sec 201, Row 25, Seats 1-7","4","Viagogo","carolynestroman490@gmx.net","252","596.36","344.36","136.7%","","SOLD","VGG","Limited view","ANO"],
  ["Olivia Rodrigo","ES-Barcelona","2.5 2027","Sec 2-212 \u2022 Row 22 \u2022 Seats 13, 15, 17, 19","4","Viagogo","ostruzina.medy0p@icloud.com","388","771.44","383.44000000000005","98.8%","","SOLD","VGG","","ANO"],
  ["Bad Bunny","DE","Sun, 21 Jun 2026, 20:00","OM-110 \u2022 Row 16 \u2022 Seats 15 - 16","2","Viagogo","theresawinn95340@outlook.com.","153.5","228.02","74.52000000000001","48.5%","","SOLD","VGG","","ANO"],
  ["KATSEYE","US-NY","Sun \u2022 Oct 25, 2026\u00a0\u2022 8:00 PM","Sec 314, Row 7, Seats 13 - 15","3","Viagogo","osudy.citronada-0g@icloud.com","262.09","386.48","124.39000000000004","47.5%","","SOLD","VGG/VDD","","ANO"],
  ["Ye Live in Tampa","US-FL","Fri \u2022 Jun 26, 2026 \u2022 8:00 PM","Sec 316, Row L, Seats 9 - 13","5","Viagogo","0parcek.vecny@icloud.com","566.92","563.03","-3.8899999999999864","-0.7%","","SOLD","VI/VGG","","ANO"],
  ["Gracie Abrams","UK","Sat, 24 Apr 2027, 18:30","Sec 311, Row 21, Seats 295 - 297","3","Viagogo","09.ohnostroj.tulit@icloud.com","234.37","","","","","ACTIVE","VGG","","NIE"],
  ["Celine Dion","FR","Saturday, May 15, 2027 to 19:30","P - ROW 73 - SEAT 193-194","2","Viagogo","meson-feather.0v@icloud.com  (KUPENY UCET)","401.99","","","","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","Wednesday, May 12, 2027 to 19:30","411 - ROW 52 - SEAT 1-3","3","Viagogo","meson-feather.0v@icloud.com  (KUPENY UCET)","600","","","","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","Saturday, May 29, 2027 to 19:30","112 - ROW 25 - SEAT 8-10","3","Viagogo","meson-feather.0v@icloud.com  (KUPENY UCET)","601.49","","","","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","Friday 28 May 2027 19 :30","104 - Rang 25 - Place 7-9","3","Viagogo","trim.03.dado@icloud.com","700","","","","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","Wednesday, May 19, 2027 to 19:30","I - ROW 105 - SEAT 33/T - ROW 104 - SEAT 152-153 (NA POLKU S KIKOM","3","Viagogo","oath_carcass0j@icloud.com","350","","","","","ACTIVE","","","NIE"],
  ["BTS","DE","Sat, 11 Jul 2026, 20:00","Sec M-219 \u2022 Row 10 \u2022 Seats 10 - 11","2","Viagogo","04-skripty.uniky@icloud.com","351.54","580","228.45999999999998","65%","","SOLD","VGG","","ANO"],
  ["BTS","UK","Tue 07 Jul 2026 \u2022 12:00 am","Sec 516 Row 30 Seats 537-539","3","Viagogo","imanie.sklz.0e@icloud.com","329.14","510","180.86","54.9%","","SOLD","VGG","","ANO"],
  ["ENG VS SPAIN","UK","Sat 26 Sept 2026, kick off 7:45 pm","Sec 528 Row 44 Seats 31-37","7","Viagogo","davidrurik001@gmail.com","369.01","650","280.99","76.1%","","SOLD","VGG","","ANO"],
  ["BSB","USA","Thu \u2022 Dec 31, 2026 \u2022 10:00 PM","Sec 108, Row 30, Seats 16 - 18","3","Viagogo","siminikovarachel@gmail.com","479.44","","","","","ACTIVE","","Limited view of Sphere screen - Full view of Band and Stage","NIE"],
  ["BSB","USA","Fri \u2022 Jan 1, 2027 \u2022 8:00 PM","Sec 405, Row 25, Seats 19 - 22","4","Viagogo","michaelasvarinska@gmail.com","449.21","760","310.79","69.2%","","SOLD","","","ANO"],
  ["BSB","USA","Thu \u2022 Dec 31, 2026 \u2022 10:00 PM","Sec 107, Row 36, Seats 6 - 8","3","Viagogo","michaelasvarinska@gmail.com","479.44","","","","","ACTIVE","","Limited view of Sphere screen - Full view of Band and Stage","NIE"],
  ["BSB","USA","Thu \u2022 Dec 31, 2026 \u2022 10:00 PM","Sec 408, Row 18, Seats 17 - 18 / Sec 408, Row 19, Seats 17 - 18","4","Viagogo","semenikovasimona@gmail.com","501.04","","","","","ACTIVE","","","NIE"],
  ["BSB","USA","Fri \u2022 Jan 1, 2027 \u2022 8:00 PM","Sec 103, Row 34, Seats 12 - 14","3","Viagogo","semenikovasimona@gmail.com","427.61","540","112.38999999999999","26.3%","","SOLD","","Limited view of Sphere screen - Full view of Band and Stage","ANO"],
  ["Bad Bunny","PT","8/23/26, 6:00 PM   220+","Sec 12, Row U, Seats 6-9","4","Viagogo","nowakpeter764@gmail.com","343.8","440","96.19999999999999","28%","","SOLD","","","ANO"],
  ["Bad Bunny","PT","8/23/26, 6:00 PM","Sec 10, Row DD, Seat 15-17","3","Viagogo","kerikbruno@gmail.com","257.82","330","72.18","28%","","SOLD","","","ANO"],
  ["Bad Bunny","PT","8/22/26, 6:00 PM","Sec 7, Row G, Seat 10-13","4","Viagogo","anetasirkovska@gmail.com","343.8","480","136.2","39.6%","","SOLD","","","ANO"],
  ["Bad Bunny","PT","8/22/26, 6:00 PM","Sec 5, Row W, Seat 13-16","4","Viagogo","semenikovasimona@gmail.com","343.8","310","-33.80000000000001","-9.8%","","SOLD","","","ANO"],
  ["Bad Bunny","PT","8/22/26, 6:00 PM","Standing","4","Viagogo","nemedovajurena@gmail.com","382.02","460","77.98000000000002","20.4%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-27 00:00:00","SECTION - ROW - SEAT 412 - J - 737","1","Viagogo","xlaura908@outlook.com","145.23","190","44.77000000000001","30.8%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-24 00:00:00","SECTION - ROW - SEAT 411 - P - 712","1","Viagogo","williamenglehardt7775@hotmail.com","145.23","180","34.77000000000001","23.9%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-24 00:00:00","SECTION - ROW - SEAT 118 - R - 538","1","Viagogo","wsuarez1d7@hotmail.com","183.92","245","61.08000000000001","33.2%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-24 00:00:00","Floor Standing - GA - GA","2","Viagogo","xcharlesdubiel@hotmail.com","258.64","420","161.36","62.4%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-24 00:00:00","SECTION - ROW - SEAT 113 - L - 397","1","Viagogo","wayne_gonzales_official@hotmail.com","184.33","170","-14.330000000000013","-7.8%","","SOLD","","Seide View","ANO"],
  ["Ariana Grande","UK","2026-08-23 00:00:00","SECTION - ROW - SEAT 107 - S - 203-4","2","Viagogo","williamheberthey@hotmail.com","325.98","520","194.01999999999998","59.5%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-09-12 00:00:00","SECTION - ROW - SEAT Porte I - 113 - 15. TRANSFERED","1","Viagogo","adawilliam19f@outlook.com","268.53","350","81.47000000000003","30.3%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-24 00:00:00","SECTION - ROW - SEAT 118 - P - 8","1","Viagogo","walterl_2513@hotmail.com","184.73","180","-4.72999999999999","-2.6%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-24 00:00:00","SECTION - ROW - SEAT 412 - T - 730","1","Viagogo","william.69.r@hotmail.com","98.91","130","31.090000000000003","31.4%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-09-19 00:00:00","SECTION - ROW - SEAT Porte 116 - 24 - 38","1","Viagogo","alice1dr@hotmail.com","268.31","400","131.69","49.1%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-27 00:00:00","Standing.   TRENSFERED","1","Viagogo","tyree_913_c@outlook.com:","161.06","220","58.94","36.6%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-27 00:00:00","Standing.  TRANSFERED","1","Viagogo","John2e9c@outlook.com","142.11","220","77.88999999999999","54.8%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-27 00:00:00","Standing.   TRANSFERED","2","Viagogo","iamwendy971@hotmail.com","284.56","450","165.44","58.1%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-27 00:00:00","Stamding.  TRANSFERED","1","Viagogo","davidson_aida_2105@outlook.com","157.04","220","62.96000000000001","40.1%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-27 00:00:00","Standing TRANSFERED DANO ZROBIL","1","Viagogo","letourneau_kellie_2503@outlook.com","157","220","63","40.1%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-09-16 00:00:00","SECTION - ROW - SEAT Porte P - 77 - 206-205  TRANSFERNUTE","2","Viagogo","wsteenbergen8466@hotmail.com","459.96","700","240.04000000000002","52.2%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-27 00:00:00","Standing. TRANSFERNUTE","1","Viagogo","tking8399@outlook.com","142.52","210","67.47999999999999","47.3%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-09-19 00:00:00","Porte G - 114 - 52","1","Viagogo","acobsprung0906@hotmail.com","153.52","300","146.48","95.4%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-28 00:00:00","Standing TRANSFERED","2","Viagogo","harrycolbert9894@outlook.com","320.93","360","39.06999999999999","12.2%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-31 00:00:00","Standing.   TRANSFERED","2","Viagogo","mm_199080@outlook.com","283.89","450","166.11","58.5%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-28 00:00:00","Standing.  TRANSFERED","1","Viagogo","davis-dino-2707@outlook.com","160.78","180","19.22","12%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-09-18 00:00:00","Porte 108 - 16 - 53","1","Viagogo","itsangelacastillo@hotmail.com","267","0","-267","-100%","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","2026-09-23 00:00:00","Porte 116 - 23 - 40-41","2","Viagogo","x-ann-weber@hotmail.com","534.76","800","265.24","49.6%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-09-19 00:00:00","Porte 403 - 48 - 1","1","Viagogo","itsjohn923@hotmail.com","229.42","229.42","0","0%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-10-17 00:00:00","Porte I - 113 - 16","1","Viagogo","xpriscilla982@hotmail.com","267.35","330","62.64999999999998","23.4%","","SOLD","","","ANO"],
  ["Ariana Grande","FR","2026-08-31 00:00:00","Standing    TRANSFERED","6","Viagogo","tidwellsean2407@outlook.com","857.74","1415.1","557.3599999999999","65%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-31 00:00:00","Standing    TRANSFERED","2","Viagogo","jambaxtee32@outlook.com","323.25","468","144.75","44.8%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-31 00:00:00","Standing TRANSFERNUTE","2","Viagogo","heymercedes029@outlook.com","323.25","448.62","125.37","38.8%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-31 00:00:00","Standing    TRANSFERED","2","Viagogo","andre.marra740@hotmail.com","284.62","441","156.38","54.9%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","104 - V - 142.   TRANSFERED","1","Viagogo","murray.guadalupe.1103@outlook.com","164.5","330","165.5","100.6%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-08-31 00:00:00","118 - T - 540.  TRANSFERED","1","Viagogo","n-ho-ea9@outlook.com","164.5","180","15.5","9.4%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","414 - H - 785. LISTNUTE.  TRANSFERNUTE","1","Viagogo","x.thomas.stovall@hotmail.com","184.21","235","50.78999999999999","27.6%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","402 - K - 478  LISTNUTE. TRANSFERNUTE","1","Viagogo","gettommy019@outlook.com","184.21","235","50.78999999999999","27.6%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","414 - K - 771-773 LISTNUTE.  TRANSFERNUTE","3","Viagogo","alyssahuffordget@hotmail.com","436.63","855","418.37","95.8%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","112 - H - 363  LISTNUTE TRANSFERNUTE","1","Viagogo","adamhoke3454@hotmail.com","199.7","410","210.3","105.3%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","415 - E - 808  LISTNUTE.  TRANSFERNUTE","1","Viagogo","adelaide.d7.j@outlook.com","145.04","235","89.96000000000001","62%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","418 - H - 871. LISTNUTE TRANSFNURE","1","Viagogo","davis-dino-2707@outlook.com","164.25","245","80.75","49.2%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","418 - S - 886. LISTNURE. TRANSFERNUTE","1","Viagogo","j.kitchens.549@outlook.com","184.33","245","60.66999999999999","32.9%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","404 - D - 543-544.  LISTNUTE   TRANSFERNURTE","2","Viagogo","m-gomes-9f1@outlook.com a xdannysanabria@hotmail.com","327.79","500","172.20999999999998","52.5%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","413 - N - 752-753.  LISTNUTE.  TRANSFERNUTE","2","Viagogo","nancyjohnson0803@outlook.com","290.52","500","209.48000000000002","72.1%","","SOLD","","","ANO"],
  ["Ariana Grande","UK","2026-09-01 00:00:00","415 - A - 810-811 TRANSFERED","2","Viagogo","ab199817@hotmail.com","255","380","125","49%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-10-07 00:00:00","Porte 117 - 30 - 3-4  L","2","Viagogo","donnace2p@outlook.com","534.76","","","","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","2026-09-18 00:00:00","Porte 405 - 48 - 26-27  L (VIA AJ SEAT)","2","Viagogo","itswilliam976@hotmail.com","458.84","458","-0.839999999999975","-0.2%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-10-03 00:00:00","Porte 405 - 41 - 28-29","2","Viagogo","angelopartidaofficial@hotmail.com","458.84","800","341.16","74.4%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-10-14 00:00:00","Porte 413 - 50 - 5-6    L(VIA AJ SEAT)","2","Viagogo","xsheilaparsons@hotmail.com","458.84","660","201.16000000000003","43.8%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-09-18 00:00:00","Porte 116 - 19 - 30","1","Viagogo","williamcardenas3972@outlook.com","267.38","267","-0.37999999999999545","-0.1%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-10-02 00:00:00","Porte 111 - 33 - 25  (SEATIKS)","1","Viagogo","themarykeel@outlook.com","267.38","300","32.620000000000005","12.2%","","SOLD","","","ANO"],
  ["Celine Dion","FR","2026-10-10 00:00:00","Porte 115 - 26 - 36  (SEATIKS)","1","Viagogo","alma_hagle_call@hotmail.com","267.38","","","","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","2026-09-19 00:00:00","Porte 409 - 52 - 21-23","3","Viagogo","yvonneb5ed@hotmail.com","460.56","720","259.44","56.3%","","SOLD","","","ANO"],
  ["NBA","UK (Manchester)","Sun, 17 Jan 2027, 15:30","Sec 105, Row 16, Seats 111 - 113","3","Viagogo","kolaciky-kopirky.0r@icloud.com","1057.52","","","","","ACTIVE","","","NIE"],
  ["\u0160ipky","London?","Friday 1 January 2027, 12:30pm 12.30","Block: Z, Row: 1, Seats: 19 - 24","6","Viagogo","davidrurik001@gmail.com","688.4","","","","","ACTIVE","","","NIE"],
  ["NBA","UK (Manchester)","Sun, 17 Jan 2027, 15:30","Sec 218, Row 6, Seats 32 - 34","3","Viagogo","odhadca.dlzka-5l@icloud.com","703.49","","","","","ACTIVE","","","NIE"],
  ["NBA","UK (Manchester)","Sun, 17 Jan 2027, 15:30","Sec 311, Row 18, Seats 297 - 300","4","Viagogo","sessile_puller.09@icloud.com  (GANDO DANY)","239.97","","","","","ACTIVE","","","NIE"],
  ["Celine Dion","FR","2026-10-10 00:00:00","Porte I - 107 - 23-24","2","Viagogo","kornutik_klaviry_0o@icloud.com","534.76","980","445.24","83.3%","","SOLD","","","ANO"],
  ["Celine DIon","FR","Wednesday, 19/05/2027, 19:30","103-1-1","1","Viagogo","anetasirkovska@gmail.com","201.49","","","","","ACTIVE","","","NIE"],
  ["Celine DIon","FR","Friday, 14/05/2027, 19:30","103-1-25","1","Viagogo","anetasirkovska@gmail.com","201.49","","","","","ACTIVE","","","NIE"],
  ["Celine DIon","FR","Saturday, 29/05/2027, 19:30","103-1-1","1","Viagogo","antonvyjeb@gmail.com","201.49","","","","","ACTIVE","","","NIE"],
  ["Celine DIon","FR","Friday, 14/05/2027, 19:30","115-1-1","1","Viagogo","antonvyjeb@gmail.com","201.49","","","","","ACTIVE","","","NIE"],
  ["Celine DIon","FR","Friday, 14/05/2027, 19:30","115-1-6","1","Viagogo","davidrurik001@gmail.com","201.49","","","","","ACTIVE","","","NIE"],
  ["Celine DIon","FR","Saturday, 29/05/2027, 19:30","105-1-2","1","Viagogo","davidrurik001@gmail.com","201.49","","","","","ACTIVE","","","NIE"],
  ["Mariah Carey","UK","Wed, 2 Dec 2026, 19:30","Sec 311, Row 17, Seats 279 - 281","3","Viagogo","linneagaylord578@gmx.net","253.3","420","166.7","65.8%","","SOLD","","","ANO"],
  ["Mariah Carey","UK","2026-11-30 00:00:00","417 - P - 844-846","3","Viagogo","kimberlywood6465@outlook.com","256.21","","","","","ACTIVE","","","NIE"],
  ["Mariah Carey","UK","2026-11-30 00:00:00","C3 - D - 40-43","4","Viagogo","xtroy942@hotmail.com","709.59","","","","","ACTIVE","","","NIE"],
  ["Mariah Carey","UK","2026-11-30 00:00:00","410 - R - 687-689","3","Viagogo","aida-35f-h@hotmail.com","256.16","","","","","ACTIVE","","","NIE"],
  ["SPAIN VS ENG","ES","15/11/26 | 20:45:00","LATERAL OESTE GRADA ALTA - 404 -0011-0006-0007","2","Viagogo","davidrurik001@gmail.com","110","","","","","ACTIVE","","","NIE"],
  ["SPAIN VS ENG","ES","15/11/26 | 20:45:00","LATERAL ESTE GRADA BAJA - 1191-0014-0009-0010-0011","3","Viagogo","davidrurik001@gmail.com","195","","","","","ACTIVE","","","NIE"],
  ["Oasis","USA","Tue \u2022 Aug 24, 2027 \u2022 7:00 PM","Sec 443, Row 8, Seats 15 - 16","2","Viagogo","antonseko351@gmail.com","194.05","","","","","ACTIVE","","","NIE"],
  ["Oasis","USA","Tue \u2022 Aug 24, 2027 \u2022 7:00 PM","Sec 443, Row 9, Seats 15 - 16","2","Viagogo","antonseko351@gmail.com","194.05","","","","","ACTIVE","","","NIE"],
  ["Oasis","USA","Sat \u2022 Aug 21, 2027 \u2022 7:00 PM","Sec 443, Row 10, Seats 11 - 12","2","Viagogo","antonseko351@gmail.com","194.05","","","","","ACTIVE","","","NIE"],
  ["Oasis","USA","Sat \u2022 Aug 21, 2027 \u2022 7:00 PM","Sec 443, Row 11, Seats 7 - 8","2","Viagogo","antonseko351@gmail.com","194.05","","","","","ACTIVE","","","NIE"],
  ["Oasis","USA","Fri \u2022 Aug 20, 2027 \u2022 7:00 PM","Sec 415, Row 16, Seats 5 - 6","2","Viagogo","antonseko351@gmail.com","295.71","","","","","ACTIVE","","","NIE"],
  ["Oasis","USA","Fri \u2022 Aug 20, 2027 \u2022 7:00 PM","Sec 415, Row 17, Seats 7 - 8","2","Viagogo","antonseko351@gmail.com","295.71","","","","","ACTIVE","","","NIE"],
  ["Oasis","USA","Fri \u2022 Aug 20, 2027 \u2022 7:00 PM","Sec 336, Row 5, Seats 3 - 5","3","Viagogo","oldish.mungo8w@icloud.com","775.15","","","","","ACTIVE","","","NIE"],
  ["Brent Faiyaz","USA","2026-12-11 00:00:00","210 - 12 - 5-9","5","Viagogo","g.stagg.bbe@outlook.com","528.83","1100","571.17","108%","","SOLD","","","ANO"],
  ["Oasis","DE","Sa., 3. Juli 2027, 18:00","Sek O-318 \u2022 Reihe 18 \u2022 Pl\u00e4tze 7 - 10","4","Viagogo","pothole.raisin-9r@icloud.com","385","","","","","ACTIVE","","PRICNESEDLO","NIE"],
  ["Oasis","DE","Fr., 2. Juli 2027, 18:00","Sek O-311 \u2022 Reihe 17 \u2022 Pl\u00e4tze 18 - 21","4","Viagogo","amulet_poshest_5o@icloud.com","385","","","","","ACTIVE","","PRICNESEDLO","NIE"],
  ["Oasis","DE","Fr., 2. Juli 2027, 18:00","Sek O-315 \u2022 Reihe 18 \u2022 Pl\u00e4tze 5 - 8","4","Viagogo","95_drawls.pagers@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Sa., 3. Juli 2027, 18:00","Sek O-314 \u2022 Reihe 15 \u2022 Pl\u00e4tze 18 - 21","4","Viagogo","fissile.clinger_6a@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Sat, 3 Jul 2027, 18:00","Sec O-322 \u2022 Row 12 \u2022 Seats 23 - 26","4","Viagogo","pertzegullayam@outlook.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec O-331 \u2022 Row 8 \u2022 Seats 9 - 12  (RESTRIDEC VIEW)","4","Viagogo","reedyqristycrv@outlook.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec O-310 \u2022 Row 14 \u2022 Seats 24 - 27","4","Viagogo","mamearshirkxs8z4l@outlook.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec O-319 \u2022 Row 16 \u2022 Seats 25 - 28","4","Viagogo","honest_jumbles.7q@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Di., 6. Juli 2027, 18:00","Sek O-317 \u2022 Reihe 19 \u2022 Pl\u00e4tze 7 - 10","4","Viagogo","remover.blades7x@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Di., 6. Juli 2027, 18:00","Sek O-320 \u2022 Reihe 17 \u2022 Pl\u00e4tze 14 - 17","4","Viagogo","icebox_rumbas.2n@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec O-310 \u2022 Row 13 \u2022 Seats 13 - 16","4","Viagogo","acronczukof9ax3hj@outlook.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec O-309 \u2022 Row 13 \u2022 Seats 1 - 4","4","Viagogo","chicken.picky.2e@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec O-331 \u2022 Row 13 \u2022 Seats 15 - 18","4","Viagogo","buezoiilievfmi17@outlook.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Sat, 3 Jul 2027, 18:00","Sec O-320 \u2022 Row 13 \u2022 Seats 9 - 12","4","Viagogo","calfozmasciamtisy@outlook.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec O-322 \u2022 Row 2 \u2022 Seats 7 - 10","4","Viagogo","watch_anvils_2g@icloud.com","661","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Sat, 3 Jul 2027, 18:00","Sec U-119 \u2022 Row 5 \u2022 Seats 23 - 24","2","Viagogo","wages.gunk.9y@icloud.com","537.5","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","3. \u010dervence 2027 18:00  (PREZISTIM)","Section: O-309  (DOPLNIM NESKOR)","4","Viagogo","bilbyygrodygk2@outlook.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Sat, 3 Jul 2027, 18:00","Sec O-321 \u2022 Row 10 \u2022 Seats 3 - 6","4","Viagogo","palmtop.prihriat_0b@icloud.com","661","","","","","ACTIVE","","","NIE"],
  ["Oasis","ES","Sun, 11 Jul 2027, 20:30","Sec LI-117 \u2022 Row 30 \u2022 Seats 22, 24, 26, 28","4","Viagogo","lahodny-valencia-0s@icloud.com","818","","","","","ACTIVE","","","NIE"],
  ["Oasis","NL","17.7 2027","Sec 1-119 Row 29 Seats 80-81","2","Viagogo","dad-etches5t@icloud.com","504.9","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Sat, 26 Jun 2027, 17:00","Sec 234, Row 56, Seats 943 - 946","4","Viagogo","vyprava06.automatika@icloud.com","348.62","","","","","ACTIVE","","","NIE"],
  ["Oasis","NL","Fri, 16 Jul 2027, 19:00","Sec 1-129 \u2022 Row 26 \u2022 Seats 176 - 179","4","Viagogo","drainer.ruffles_2r@icloud.com","807.84","","","","","ACTIVE","","","NIE"],
  ["Oasis","NL","Fri, 16 Jul 2027, 19:00","Sec 1-104 \u2022 Row 12 \u2022 Seats 118 - 119","2","Viagogo","insert-pickles.66@icloud.com","504.9","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Fri, 25 Jun 2027, 17:00","Sec 235, Row 44, Seats 975 - 978","4","Viagogo","proper-brook5m@icloud.com","508.51","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Sat, 29 May 2027, 17:00","Sec WS2, Row B, Seats 9 - 12","4","Viagogo","bakery.hammer-7r@icloud.com","1245.29","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Sat, 29 May 2027, 17:00","Sec WS2, Row B, Seats 35 - 38","4","Viagogo","martha_kluttd@web.de","1245.29","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Sat, 26 Jun 2027, 17:00","Sec 134, Row 20, Seats 942 - 945","4","Viagogo","vizie.vezicky9k@icloud.com","965.48","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Sat, 26 Jun 2027, 17:00","Sec 035, Row 20, Seats 982 - 984","3","Viagogo","zonalny.tymus.2e@icloud.com","724.1","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Sat, 26 Jun 2027, 17:00","Sec 134, Row 9, Seats 943 - 944","2","Viagogo","vodnica.kusy00@icloud.com","481.3","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Sat, 3 Jul 2027, 18:00","Sec M-233 \u2022 Row 21 \u2022 Seats 9 - 11","3","Viagogo","bazmegjezko@gmail.com","651","","","","","ACTIVE","","PARTIAL OBSTRUCED","NIE"],
  ["Oasis","DE","Tue, 6 Jul 2027, 18:00","Sec O-321 \u2022 Row 12 \u2022 Seats 19 - 22","4","Viagogo","tycoon-fidget70@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Tue, 6 Jul 2027, 18:00","Sec O-308 \u2022 Row 12 \u2022 Seats 17 - 20","4","Viagogo","comment.68.epoxy@icloud.com","385","","","","","ACTIVE","","","NIE"],
  ["Oasis","ES","Sun, 11 Jul 2027, 20:30","Sec GI-105 \u2022 Row 32 \u2022 Seats 29, 31, 33, 35","4","Viagogo","comma.round.9b@icloud.com","818","","","","","ACTIVE","","","NIE"],
  ["Oasis","ES","Sun, 11 Jul 2027, 20:30","Sec GI-109 \u2022 Row 35 \u2022 Seats 9, 11, 13, 15","4","Viagogo","sladsi_prilis_2l@icloud.com","818","","","","","ACTIVE","","","NIE"],
  ["Oasis","ES","Sat, 10 Jul 2027, 20:30","Sec GI-115 \u2022 Row 29 \u2022 Seats 9, 11","2","Viagogo","hornaty.analytik_3a@icloud.com","410","","","","","ACTIVE","","","NIE"],
  ["Oasis","ES","Sun, 11 Jul 2027, 20:30","Sec TI-104 \u2022 Row 21 \u2022 Seats 23, 25","2","Viagogo","hornaty.analytik_3a@icloud.com","410","","","","","ACTIVE","","","NIE"],
  ["Oasis","ES","Sat, 10 Jul 2027, 20:30","Sec TI-104 \u2022 Row 23 \u2022 Seats 28, 30","2","Viagogo","blush_zinnia6r@icloud.com","410","","","","","ACTIVE","","","NIE"],
  ["Oasis","ES","Sat, 10 Jul 2027, 20:30","Sec GI-105 \u2022 Row 23 \u2022 Seats 15, 17","2","Viagogo","blush_zinnia6r@icloud.com","410","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Sat, 3 Jul 2027, 18:00","Sec U-115 \u2022 Row 10 \u2022 Seats 13 - 14","2","Viagogo","gibbon50.diary@icloud.com","434","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec U-119 \u2022 Row 24 \u2022 Seats 6 - 7","2","Viagogo","gibbon50.diary@icloud.com","537.5","","","","","ACTIVE","","","NIE"],
  ["Oasis","DE","Fri, 2 Jul 2027, 18:00","Sec U-121 \u2022 Row 4 \u2022 Seats 10 - 11","2","Viagogo","tailor.jazz_2w@icloud.com","537.5","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Fri, 28 May 2027, 17:00","Sec 102, Row M, Seats 20 - 23","4","Viagogo","tietjens.dominic09@web.de","945.3","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Fri, 25 Jun 2027, 17:00","Sec 240, Row 53, Seats 1125 - 1127","3","Viagogo","chafe-trim2y@icloud.com","259.9","","","","","ACTIVE","","MARKO UCET","NIE"],
  ["Oasis","UK","Tue, 8 Jun 2027, 17:00","Sec 135, Row 19, Seats 977 - 980","4","Viagogo","testery.cenganie_4n@icloud.com","961.05","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Fri, 25 Jun 2027, 17:00","Sec 133, Row 9, Seats 908 - 911","4","Viagogo","cuvnut_syr53@icloud.com","806.42","","","","","ACTIVE","","","NIE"],
  ["Oasis","UK","Fri, 18 Jun 2027, 17:00","Sec 032, Row 22, Seats 869 - 872","4","Viagogo","tekuty.zasvateny_4m@icloud.com","806.42","","","","","ACTIVE","","","NIE"]
  ];

  var toAdd = EXCEL.filter(function(r) {
    var buy = parseFloat(r[7]) || 0;
    return !existing[(r[0]+'|'+r[1]+'|'+Math.round(buy))];
  });

  if (!toAdd.length) { Browser.msgBox('Vsetko uz je v sheete!'); return; }

  sheet.insertRowsAfter(lastRow, toAdd.length);
  var values = toAdd.map(function(r, i) {
    var buy  = parseFloat(r[7]) || 0;
    var sell = parseFloat(r[8]) || 0;
    var prof = sell ? round2(sell - buy) : '';
    var roi  = sell && buy ? round1((sell - buy)/buy*100)+'%' : '';
    return [maxNum+i+1, r[0],r[1],r[2],r[3], parseInt(r[4])||1, r[5],r[6],
            buy, sell||'', prof, roi, r[11],r[12],r[13],r[14],r[15]];
  });
  sheet.getRange(lastRow+1, 1, values.length, 17).setValues(values);
  Browser.msgBox('Hotovo! Pridanych ' + toAdd.length + ' ticketov.');
}
