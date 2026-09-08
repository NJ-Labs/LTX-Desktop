import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const filePath = "D:/Projects/LTX-Desktop/outputs/gantt-edit/ltx-safety-video-gantts-manager-he.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(filePath));

for (const sheetName of ["Projects", "Goals", "Gantt", "Resources", "Roles"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  const table = await workbook.inspect({
    kind: "table",
    range: `${sheetName}!${used.address.split("!").pop()}`,
    include: "values",
    tableMaxRows: 1,
    tableMaxCols: 12,
    maxChars: 3000,
  });
  console.log(table.ndjson);
}
