import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "D:/Projects/LTX-Desktop";
const inputPath = path.join(root, "ltx-safety-video-gantts-import-he.xlsx");
const outputDir = path.join(root, "outputs", "gantt-edit");
const outputPath = path.join(outputDir, "ltx-safety-video-gantts-manager-he.xlsx");
const project = "מפת דרכים אחת לסרטוני בטיחות ב-LTX Desktop";

const ganttRows = [
  ["מספר", "פרויקט", "משימה", "תאריך התחלה", "משך (ימים)", "התקדמות (%)", "מצב", "אבן דרך", "אחראי", "תלוי ב"],
  ["1", project, "תוכנית כוללת: סרטוני בטיחות לארגון", "2026-03-05", 151, 45, "בתהליך", "לא", "מנהל הפרויקט", ""],
  ["1.1", project, "הכנת סרטון בטיחות ראשון", "2026-03-05", 3, 100, "הושלם", "לא", "מנהל הפרויקט", ""],
  ["1.1.1", project, "קביעת דרך עבודה פשוטה להכנת סרטון", "2026-03-05", 1, 100, "הושלם", "לא", "צוות בטיחות", ""],
  ["1.1.2", project, "התאמת הסרטון למסכים ולטלפונים", "2026-03-05", 1, 100, "הושלם", "לא", "צוות וידאו", ""],
  ["1.1.3", project, "אפשרות לשפר סרטון שלא ברור מספיק", "2026-03-05", 1, 100, "הושלם", "לא", "צוות וידאו", ""],
  ["1.1.4", project, "אבן דרך: סרטון בטיחות ראשון לבדיקה", "2026-03-05", 0, 100, "הושלם", "כן", "מנהל הפרויקט", ""],
  ["1.2", project, "הפיכת השימוש לקל וברור", "2026-03-05", 5, 100, "הושלם", "לא", "מנהל הפרויקט", ""],
  ["1.2.1", project, "מסך ברור שמראה מה קורה בזמן הכנת הסרטון", "2026-03-05", 1, 100, "הושלם", "לא", "צוות מוצר", ""],
  ["1.2.2", project, "החלפת הודעות טכניות במילים פשוטות", "2026-03-05", 1, 100, "הושלם", "לא", "צוות מוצר", ""],
  ["1.2.3", project, "שמירה מסודרת של הסרטונים לפי פרויקט", "2026-03-07", 2, 100, "הושלם", "לא", "צוות מוצר", ""],
  ["1.2.4", project, "אבן דרך: תהליך עבודה ברור למשתמש", "2026-03-05", 0, 100, "הושלם", "כן", "מנהל הפרויקט", ""],
  ["1.3", project, "סדר וניהול של סרטונים מוכנים", "2026-03-07", 6, 100, "הושלם", "לא", "צוות הטמעה", ""],
  ["1.3.1", project, "ריכוז כל הסרטונים במקום קבוע ונוח", "2026-03-07", 2, 100, "הושלם", "לא", "צוות מוצר", ""],
  ["1.3.2", project, "הפרדת סרטונים לפי נושא או פרויקט בטיחות", "2026-03-08", 2, 100, "הושלם", "לא", "צוות מוצר", ""],
  ["1.3.3", project, "אפשרות להסיר סרטונים שכבר לא צריך", "2026-03-09", 1, 100, "הושלם", "לא", "צוות בטיחות", ""],
  ["1.3.4", project, "אבן דרך: ניהול תוצרים מוכן לעבודה", "2026-03-11", 0, 100, "הושלם", "כן", "צוות הטמעה", ""],
  ["1.4", project, "הכנה לשימוש במחשבי הארגון", "2026-03-09", 18, 100, "הושלם", "לא", "צוות תפעול", ""],
  ["1.4.1", project, "בדיקה שהכלי עובד על מחשבי עבודה מתאימים", "2026-03-09", 5, 100, "הושלם", "לא", "צוות תפעול", ""],
  ["1.4.2", project, "הכנה למחשבים בלי חיבור חופשי לאינטרנט", "2026-03-22", 5, 100, "הושלם", "לא", "צוות תפעול", ""],
  ["1.4.3", project, "הכנת הוראות התקנה ותמיכה ראשוניות", "2026-03-16", 5, 100, "הושלם", "לא", "צוות הטמעה", ""],
  ["1.4.4", project, "אבן דרך: הכלי מוכן לבדיקה בארגון", "2026-03-22", 0, 100, "הושלם", "כן", "צוות תפעול", ""],
  ["1.5", project, "שיפור איכות הסרטונים והצפייה בהם", "2026-06-15", 10, 100, "הושלם", "לא", "צוות וידאו", ""],
  ["1.5.1", project, "הצגת כל הסרטונים במקום אחד לצפייה ובחירה", "2026-06-15", 3, 100, "הושלם", "לא", "צוות מוצר", ""],
  ["1.5.2", project, "סימון סרטונים שדורשים שיפור", "2026-06-15", 1, 100, "הושלם", "לא", "צוות בטיחות", ""],
  ["1.5.3", project, "טיפול ברור במקרים שבהם הכנת סרטון נכשלת", "2026-06-22", 2, 100, "הושלם", "לא", "צוות הטמעה", ""],
  ["1.5.4", project, "אבן דרך: גלריית סרטוני בטיחות מוכנה", "2026-06-22", 0, 100, "הושלם", "כן", "מנהל הפרויקט", ""],
  ["1.6", project, "ספריית תרחישים ותבניות בטיחות", "2026-06-24", 18, 30, "בתהליך", "לא", "צוות בטיחות", ""],
  ["1.6.1", project, "הכנת בסיס לתרחישי בטיחות חוזרים", "2026-06-24", 3, 100, "הושלם", "לא", "צוות בטיחות", ""],
  ["1.6.2", project, "בחירת דוגמאות ראשונות למצבי סיכון", "2026-07-01", 5, 0, "טרם התחיל", "לא", "צוות בטיחות", ""],
  ["1.6.3", project, "כתיבת נוסחים קצרים וברורים לעובדים", "2026-07-08", 8, 0, "טרם התחיל", "לא", "צוות בטיחות", ""],
  ["1.6.4", project, "אבן דרך: ספריית תבניות ראשונה", "2026-07-17", 0, 0, "טרם התחיל", "כן", "מנהל הפרויקט", ""],
  ["1.7", project, "פיילוט עם מנהלים ועובדים", "2026-07-20", 53, 0, "טרם התחיל", "לא", "צוות הטמעה", ""],
  ["1.7.1", project, "בחירת שלושה נושאי בטיחות לפיילוט", "2026-07-20", 5, 0, "טרם התחיל", "לא", "מנהל הפרויקט", ""],
  ["1.7.2", project, "הכנת סרטוני הפיילוט והצגתם למנהלים", "2026-07-27", 10, 0, "טרם התחיל", "לא", "צוות וידאו", ""],
  ["1.7.3", project, "איסוף משוב ממנהלים ועובדים", "2026-08-10", 10, 0, "טרם התחיל", "לא", "צוות הטמעה", ""],
  ["1.7.4", project, "שיפור הסרטונים לפי המשוב", "2026-08-24", 15, 0, "טרם התחיל", "לא", "צוות בטיחות", ""],
  ["1.7.5", project, "הדרכת צוותי בטיחות לשימוש עצמאי", "2026-09-14", 10, 0, "טרם התחיל", "לא", "צוות הטמעה", ""],
  ["1.7.6", project, "אבן דרך: אישור מנהלים להטמעת הסרטונים", "2026-09-30", 0, 0, "טרם התחיל", "כן", "מנהל הפרויקט", ""],
  ["1.8", project, "בדיקות אחרונות והעברה לשימוש קבוע", "2026-07-01", 65, 0, "טרם התחיל", "לא", "צוות תפעול", ""],
  ["1.8.1", project, "בדיקה שהכלי עומד בעומס עבודה אמיתי", "2026-07-01", 10, 0, "טרם התחיל", "לא", "צוות תפעול", ""],
  ["1.8.2", project, "בדיקת התקנה במחשבי הארגון", "2026-07-15", 10, 0, "טרם התחיל", "לא", "צוות תפעול", ""],
  ["1.8.3", project, "בדיקת הרשאות ואבטחת שימוש", "2026-07-29", 10, 0, "טרם התחיל", "לא", "צוות תפעול", ""],
  ["1.8.4", project, "הכנת מדריך שימוש פשוט לצוותי בטיחות", "2026-08-12", 12, 0, "טרם התחיל", "לא", "צוות הטמעה", ""],
  ["1.8.5", project, "העברת ידע לתמיכה ולתפעול", "2026-08-31", 15, 0, "טרם התחיל", "לא", "צוות הטמעה", ""],
  ["1.8.6", project, "אבן דרך: אישור סופי לשימוש קבוע", "2026-09-30", 0, 0, "טרם התחיל", "כן", "מנהל הפרויקט", ""],
];

const managerGanttRows = ganttRows.map(
  ([id, _projectName, task, start, duration, progress, status, milestone, owner, pred], index) => [
    id,
    index === 0 ? "Project" : project,
    task,
    start,
    duration,
    progress,
    status === "בתהליך" ? "In Progress" : status === "הושלם" ? "Completed" : status === "טרם התחיל" ? "Pending" : status,
    milestone === "כן" ? "Yes" : milestone === "לא" ? "No" : milestone,
    owner,
    pred || (index > 1 ? ganttRows[index - 1][0] : ""),
  ],
);
managerGanttRows[0] = ["Task ID", "Project", "Task Name", "Start Date", "Duration (Days)", "Progress (%)", "Status", "Milestone", "Resource", "PRED"];

const goalsRows = [
  ["Project", "Milestone", "Date", "Progress (%)", "Status"],
  [project, "סרטון בטיחות ראשון לבדיקה", "2026-03-05", 100, "completed"],
  [project, "ניהול תוצרים מוכן לעבודה", "2026-03-11", 100, "completed"],
  [project, "הכלי מוכן לבדיקה בארגון", "2026-03-22", 100, "completed"],
  [project, "גלריית סרטוני בטיחות מוכנה", "2026-06-22", 100, "completed"],
  [project, "ספריית תבניות ראשונה", "2026-07-17", 0, "pending"],
  [project, "אישור מנהלים להטמעת הסרטונים", "2026-09-30", 0, "pending"],
  [project, "אישור סופי לשימוש קבוע", "2026-09-30", 0, "pending"],
];

const resourcesRows = [
  ["Project", "Name", "Role", "Color", "Capacity (%)"],
  [project, "מנהל הפרויקט", "אחריות כוללת, סדר עדיפויות ואישור מנהלים", "#D93A3A", 100],
  [project, "צוות בטיחות", "בחירת תכנים, בדיקת מסרים ואישור מקצועי", "#2563EB", 100],
  [project, "צוות וידאו", "הכנת סרטונים ושיפור איכות התוצרים", "#059669", 100],
  [project, "צוות מוצר", "פישוט חוויית השימוש וסידור התוצרים", "#7C3AED", 100],
  [project, "צוות הטמעה", "פיילוט, הדרכות ואיסוף משוב", "#EA580C", 100],
  [project, "צוות תפעול", "התקנה, בדיקות מחשבים ותמיכה שוטפת", "#0F766E", 100],
  [project, "מנהל בטיחות", "אישור מקצועי של התכנים", "#2563EB", 100],
  [project, "נציג מנהלים", "בדיקת התאמה לצורכי הנהלה", "#7C3AED", 100],
  [project, "תמיכה ארגונית", "סיוע למשתמשים לאחר ההטמעה", "#EA580C", 100],
];

const rolesRows = [
  ["Project", "Name", "Budget", "Paid By", "Currency"],
  [project, "ניהול הפרויקט", 0, "monthly", "ILS"],
  [project, "תוכן בטיחות", 0, "monthly", "ILS"],
  [project, "הפקת וידאו", 0, "monthly", "ILS"],
  [project, "הטמעה והדרכה", 0, "monthly", "ILS"],
  [project, "תפעול ותמיכה", 0, "monthly", "ILS"],
  [project, "ניהול בטיחות", 0, "monthly", "ILS"],
  [project, "אישור מנהלים", 0, "monthly", "ILS"],
  [project, "תמיכה לאחר הטמעה", 0, "monthly", "ILS"],
  [project, "בדיקת תוכן", 0, "monthly", "ILS"],
  [project, "תיאום ארגוני", 0, "monthly", "ILS"],
];

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

function resetTables(sheet) {
  for (const table of [...sheet.tables.items]) {
    table.delete();
  }
}

function writeSheet(sheetName, rows, tableName) {
  const sheet = workbook.worksheets.getItem(sheetName);
  resetTables(sheet);
  const used = sheet.getUsedRange();
  used.clear({ applyTo: "all" });
  const range = sheet.getRangeByIndexes(0, 0, rows.length, rows[0].length);
  range.values = rows;
  const tableRange = sheet.getRangeByIndexes(0, 0, rows.length, rows[0].length);
  const table = sheet.tables.add(tableRange.address.split("!").pop(), true, tableName);
  table.style = "TableStyleMedium2";
  table.showFilterButton = true;
  sheet.freezePanes.freezeRows(1);
  sheet.showGridLines = false;
  return sheet;
}

const projects = workbook.worksheets.getItem("Projects");
resetTables(projects);
projects.getUsedRange().clear({ applyTo: "all" });
projects.getRange("A1:G2").values = [
  ["Title", "Department", "Division", "Field", "Description", "Status", "Due Date"],
  [
    project,
    "בטיחות והדרכה",
    "הכנת סרטוני בטיחות ברורים לעובדים ולמנהלים",
    "מודעות ומניעת סיכונים",
    "גאנט פשוט למנהלים. התוכנית מתחילה ב-2026-03-05 ומסתיימת באישור סופי ב-2026-09-30.",
    "In Progress",
    "2026-09-30",
  ],
];
projects.tables.add("A1:G2", true, "ProjectsSummary");
projects.showGridLines = false;

const goals = writeSheet("Goals", goalsRows, "GoalsSummary");
const gantt = writeSheet("Gantt", managerGanttRows, "ManagerGantt");
const resources = writeSheet("Resources", resourcesRows, "ResourceSummary");
const roles = writeSheet("Roles", rolesRows, "RolesSummary");

projects.getRange("A1:G1").format = { fill: "#0F766E", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
projects.getRange("A2:G2").format = { wrapText: true, horizontalAlignment: "right" };
projects.getRange("A:A").format.columnWidthPx = 240;
projects.getRange("B:D").format.columnWidthPx = 150;
projects.getRange("E:E").format.columnWidthPx = 420;
projects.getRange("F:G").format.columnWidthPx = 120;

goals.getRange("A1:E1").format = { fill: "#0F766E", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
goals.getRange("A:E").format = { wrapText: true, horizontalAlignment: "right" };
goals.getRange("A:A").format.columnWidthPx = 250;
goals.getRange("B:B").format.columnWidthPx = 280;
goals.getRange("C:E").format.columnWidthPx = 120;

gantt.getRange("A1:J1").format = { fill: "#0F766E", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
gantt.getRange(`A2:J${managerGanttRows.length}`).format = { wrapText: true, horizontalAlignment: "right" };
gantt.getRange(`A2:A${managerGanttRows.length}`).format.horizontalAlignment = "center";
gantt.getRange(`D2:H${managerGanttRows.length}`).format.horizontalAlignment = "center";
gantt.getRange("A:A").format.columnWidthPx = 70;
gantt.getRange("B:B").format.columnWidthPx = 260;
gantt.getRange("C:C").format.columnWidthPx = 430;
gantt.getRange("D:D").format.columnWidthPx = 120;
gantt.getRange("E:E").format.columnWidthPx = 95;
gantt.getRange("F:F").format.columnWidthPx = 105;
gantt.getRange("G:H").format.columnWidthPx = 105;
gantt.getRange("I:I").format.columnWidthPx = 130;
gantt.getRange("J:J").format.columnWidthPx = 90;
gantt.getRange(`D2:D${managerGanttRows.length}`).setNumberFormat("yyyy-mm-dd");
gantt.getRange(`F2:F${managerGanttRows.length}`).setNumberFormat("0");

for (let i = 2; i <= managerGanttRows.length; i += 1) {
  const id = String(managerGanttRows[i - 1][0]);
  const rowRange = gantt.getRange(`A${i}:J${i}`);
  if (!id.includes(".")) {
    rowRange.format = { fill: "#E0F2F1", font: { bold: true }, wrapText: true };
  } else if (id.split(".").length === 2) {
    rowRange.format = { fill: "#F1F5F9", font: { bold: true }, wrapText: true };
  }
}

resources.getRange("A1:E1").format = { fill: "#0F766E", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
resources.getRange("A:E").format = { wrapText: true, horizontalAlignment: "right" };
resources.getRange("A:A").format.columnWidthPx = 250;
resources.getRange("B:B").format.columnWidthPx = 130;
resources.getRange("C:C").format.columnWidthPx = 360;
resources.getRange("D:E").format.columnWidthPx = 110;

roles.getRange("A1:E1").format = { fill: "#0F766E", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
roles.getRange("A:E").format = { wrapText: true, horizontalAlignment: "right" };
roles.getRange("A:A").format.columnWidthPx = 250;
roles.getRange("B:B").format.columnWidthPx = 180;
roles.getRange("C:E").format.columnWidthPx = 110;

const errorScan = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log("ERROR_SCAN");
console.log(errorScan.ndjson);

const ganttCheck = await workbook.inspect({
  kind: "table",
  range: `Gantt!A1:J${managerGanttRows.length}`,
  include: "values,formulas",
  tableMaxRows: 55,
  tableMaxCols: 10,
  tableMaxCellChars: 120,
  maxChars: 30000,
});
console.log("GANTT_CHECK");
console.log(ganttCheck.ndjson);

await fs.mkdir(outputDir, { recursive: true });
for (const name of workbook.worksheets.items.map((sheet) => sheet.name)) {
  const preview = await workbook.render({
    sheetName: name,
    autoCrop: "all",
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(outputDir, `${name.replace(/[\\/:*?"<>|]/g, "_")}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
