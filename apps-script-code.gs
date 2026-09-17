// Вставити повністю в Extensions -> Apps Script вашої Google-таблиці
// (замінивши весь стандартний вміст файлу Code.gs).

var SECRET = "b-agNo5IhMfpMsq9IQv31cpE0AI9rz-d";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "bad secret" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheetName = data.sheet;
    var values = data.values || [];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    sheet.appendRow(values);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
