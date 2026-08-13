import { strToU8, unzipSync, zipSync } from "fflate";
import type { Claim } from "./page";

type RetireeExportRecord = {
  year: number;
  rank: string;
  name: string;
  unit?: string;
  retirementDate: string;
  retirementDisplay?: string;
  calRequirements: string;
  lumpSumRequirements: string;
  remarks: string;
};

type ExportCategory = "KIPO" | "WIPO" | "Retirees";
type ExportGroup =
  | { category: "KIPO" | "WIPO"; year: number; records: Claim[] }
  | { category: "Retirees"; year: number; records: RetireeExportRecord[] };

const decoder = new TextDecoder();
const templatePath = (category: ExportCategory, year: number) =>
  `/excel-templates/${category}_${year}.xlsx`;

const xmlEscape = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const columnName = (index: number) => {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  }
  return result;
};

const textCell = (address: string, style: string | undefined, value: unknown) =>
  `<c r="${address}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;

const downloadXlsx = (bytes: Uint8Array, filename: string) => {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const resolveWorksheetPath = (files: Record<string, Uint8Array>, expectedName: string) => {
  const workbookXml = decoder.decode(files["xl/workbook.xml"]);
  const relationshipsXml = decoder.decode(files["xl/_rels/workbook.xml.rels"]);
  const sheetPattern = /<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g;
  let relationshipId = "";
  for (const match of workbookXml.matchAll(sheetPattern)) {
    if (match[1].trim() === expectedName) {
      relationshipId = match[2];
      break;
    }
  }
  if (!relationshipId) throw new Error(`The official ${expectedName} worksheet was not found.`);
  const relPattern = new RegExp(`<Relationship\\b[^>]*Id="${relationshipId}"[^>]*Target="([^"]+)"[^>]*/>`);
  const target = relationshipsXml.match(relPattern)?.[1];
  if (!target) throw new Error(`The official ${expectedName} worksheet link is invalid.`);
  const normalized = target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
  return `xl/${normalized}`;
};

const styleMapFromRow = (sheetXml: string, oneBasedRow: number) => {
  const rowXml = sheetXml.match(new RegExp(`<row\\b[^>]*r="${oneBasedRow}"[^>]*>[\\s\\S]*?</row>`))?.[0] || "";
  const map = new Map<number, string>();
  for (const match of rowXml.matchAll(/<c\b[^>]*r="([A-Z]+)\d+"[^>]*?(?:s="(\d+)")?[^>]*>/g)) {
    let col = 0;
    for (const char of match[1]) col = col * 26 + char.charCodeAt(0) - 64;
    map.set(col - 1, match[2] || "");
  }
  const attrs = rowXml.match(/^<row\b([^>]*)>/)?.[1]
    ?.replace(/\s+r="\d+"/, "")
    ?.replace(/\s+spans="[^"]*"/, "") || "";
  return { map, attrs };
};

const claimValues = (record: Claim, index: number) => {
  const b = record.benefits || {};
  if (record.type === "WIPO") return [
    index + 1, `${record.rank} ${record.name}`.trim(), record.dateDisplay || record.date,
    record.office || record.province, "", b.rhe, b.specialPromotion, b.awards,
    b.scholarship, b.psmbfi, b.psfSfa, b.others, record.injury,
  ];
  if (record.year === 2025) return [
    index + 1, `${record.rank} ${record.name}`.trim(), record.office, record.province,
    record.dateDisplay || record.date, b.pnpSfa, b.cal, b.promotion, b.awards,
    b.napolcom, b.burial, b.pension, b.scholarship, b.psslai, b.afpmbai,
    b.afpslai, b.psmbfi, b.psfSfa, b.education, b.philHealth, b.others,
  ];
  return [
    index + 1, `${record.rank} ${record.name}`.trim(), record.office || record.province,
    record.dateDisplay || record.date, b.pnpSfa, b.cal, b.promotion, b.awards,
    b.napolcom, b.burial, b.pension, b.scholarship, b.psmbfi, b.psfSfa,
    b.education, b.philHealth, b.others,
  ];
};

const retireeValues = (record: RetireeExportRecord, index: number) => [
  index + 1, "", `${record.rank} ${record.name}`.trim(), record.unit || "",
  record.retirementDisplay || record.retirementDate, record.calRequirements,
  record.lumpSumRequirements, record.remarks,
];

const patchTemplate = async (group: ExportGroup) => {
  const response = await fetch(templatePath(group.category, group.year));
  if (!response.ok) throw new Error(`Unable to load ${group.category} ${group.year} Excel template.`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const expectedName = group.category === "Retirees" ? `Compulsory ${group.year}` : `${group.category} ${group.year}`;
  const worksheetPath = resolveWorksheetPath(files, expectedName);
  let sheetXml = decoder.decode(files[worksheetPath]);
  const dataStart = group.category === "Retirees" ? 4 : 7;
  const lastCol = group.category === "Retirees" ? 8 : group.category === "WIPO" ? 13 : group.year === 2025 ? 21 : 17;
  const { map: styles, attrs } = styleMapFromRow(sheetXml, dataStart);

  const sheetData = sheetXml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  if (!sheetData) throw new Error(`The official ${expectedName} worksheet data is invalid.`);
  const headerRows = [...sheetData[1].matchAll(/<row\b[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g)]
    .filter(match => Number(match[1]) < dataStart)
    .map(match => match[0])
    .join("");
  const rows = group.records.map((record, index) => {
    const rowNumber = dataStart + index;
    const values = group.category === "Retirees"
      ? retireeValues(record as RetireeExportRecord, index)
      : claimValues(record as Claim, index);
    const cells = values.map((value, col) =>
      textCell(`${columnName(col)}${rowNumber}`, styles.get(col), value),
    ).join("");
    return `<row r="${rowNumber}" spans="1:${lastCol}"${attrs}>${cells}</row>`;
  }).join("");
  const finalRow = dataStart + Math.max(group.records.length - 1, 0);
  sheetXml = sheetXml
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${columnName(lastCol - 1)}${finalRow}"/>`)
    .replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${headerRows}${rows}</sheetData>`)
    .replace(/(<autoFilter\b[^>]*ref=")[^"]+(")/, `$1A${dataStart - 1}:${columnName(lastCol - 1)}${finalRow}$2`);
  files[worksheetPath] = strToU8(sheetXml);

  let workbookXml = decoder.decode(files["xl/workbook.xml"]);
  const escapedName = expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  workbookXml = workbookXml.replace(
    new RegExp(`(<definedName\\b[^>]*name="_xlnm\\.Print_Area"[^>]*>[^<]*'${escapedName}'!\\$A\\$\\d+:\\$[A-Z]+\\$)\\d+(</definedName>)`),
    `$1${finalRow}$2`,
  );
  files["xl/workbook.xml"] = strToU8(workbookXml);
  return zipSync(files, { level: 6 });
};

const pauseBetweenDownloads = () => new Promise(resolve => setTimeout(resolve, 180));

export async function exportClaimsExcel(records: Claim[], filename = "PRO4A-KIPO-WIPO-Registry.xlsx") {
  const groups = ([2025, 2026] as const).flatMap(year =>
    (["KIPO", "WIPO"] as const).map(category => ({
      category,
      year,
      records: records.filter(record => record.type === category && record.year === year),
    })),
  ).filter(group => group.records.length > 0);
  if (!groups.length) throw new Error("There are no KIPO/WIPO records to export.");

  for (const [index, group] of groups.entries()) {
    const base = groups.length === 1
      ? filename.replace(/\.xlsx$/i, "")
      : `PRO4A-${group.category}-${group.year}`;
    downloadXlsx(await patchTemplate(group), `${base}.xlsx`);
    if (index < groups.length - 1) await pauseBetweenDownloads();
  }
}

export async function exportRetireesExcel(records: RetireeExportRecord[], prefix = "PRO4A-Retirees") {
  const groups = [...new Set(records.map(record => record.year))]
    .sort()
    .map(year => ({
      category: "Retirees" as const,
      year,
      records: records.filter(record => record.year === year),
    }));
  if (!groups.length) throw new Error("There are no retiree records to export.");

  for (const [index, group] of groups.entries()) {
    downloadXlsx(await patchTemplate(group), `${prefix}-${group.year}.xlsx`);
    if (index < groups.length - 1) await pauseBetweenDownloads();
  }
}
