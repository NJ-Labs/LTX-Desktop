import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const root = "D:/Projects/LTX-Desktop";
const inputPath = path.join(root, "ltx-safety-video-gantts-import-he.xlsx");
const outputDir = path.join(root, "outputs", "gantt-edit-inspect");

await fs.mkdir(outputDir, { recursive: true });

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const overview = await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 12000,
  tableMaxRows: 25,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
});
console.log("OVERVIEW");
console.log(overview.ndjson);

const sheets = await workbook.inspect({ kind: "sheet", include: "id,name" });
console.log("SHEETS");
console.log(sheets.ndjson);

for (const name of workbook.worksheets.items.map((sheet) => sheet.name)) {
  const used = workbook.worksheets.getItem(name).getUsedRange();
  const region = await workbook.inspect({
    kind: "table",
    range: `${name}!${used.address.split("!").pop()}`,
    include: "values,formulas",
    tableMaxRows: 80,
    tableMaxCols: 30,
    tableMaxCellChars: 120,
    maxChars: 25000,
  });
  console.log(`TABLE ${name}`);
  console.log(region.ndjson);

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
