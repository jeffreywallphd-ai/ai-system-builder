import type { DatasetVersionArtifact, DatasetVersionDocumentation } from "../../../contracts/dataset";

export interface DatasetVersionDocumentationArtifacts { readonly card: string; readonly croissant: string; }

export function createDatasetVersionDocumentationArtifacts(input: {
  readonly documentation: DatasetVersionDocumentation;
  readonly artifacts: readonly DatasetVersionArtifact[];
  readonly totalRows: number;
}): DatasetVersionDocumentationArtifacts {
  return { card: createDatasetCard(input), croissant: JSON.stringify(createCroissantDocument(input), null, 2) + "\n" };
}

function createDatasetCard(input: { readonly documentation: DatasetVersionDocumentation; readonly artifacts: readonly DatasetVersionArtifact[]; readonly totalRows: number }): string {
  const { documentation } = input;
  const frontMatter = ["---", `pretty_name: ${yamlText(documentation.name)}`, ...(documentation.license ? [`license: ${yamlText(documentation.license)}`] : []), ...(documentation.languages?.length ? ["language:", ...documentation.languages.map((language) => `- ${yamlText(language)}`)] : []), "---"];
  return [...frontMatter, "", `# ${documentation.name}`, "", documentation.summary, "", "## What this dataset is for", "", ...markdownItems(documentation.intendedUses), "", "## Important limitations", "", ...markdownItems(documentation.limitations), "", "## Dataset size", "", `${input.totalRows.toLocaleString("en-US")} rows across ${input.artifacts.filter(isDataArtifact).length} data file(s).`, ...(documentation.citation ? ["", "## Citation", "", documentation.citation] : []), ""].join("\n");
}

function createCroissantDocument(input: { readonly documentation: DatasetVersionDocumentation; readonly artifacts: readonly DatasetVersionArtifact[]; readonly totalRows: number }): Record<string, unknown> {
  const distributions = input.artifacts.filter(isDataArtifact).map((artifact, index) => ({
    "@type": "cr:FileObject", "@id": `file-${artifact.role}-${index + 1}`, name: artifact.role,
    description: `${displayRole(artifact.role)} data for ${input.documentation.name}.`, contentUrl: publicationPath(artifact, index),
    encodingFormat: artifact.mediaType, sha256: artifact.digest.slice("sha256:".length), contentSize: `${artifact.sizeBytes}`,
  }));
  return {
    "@context": { "@language": "en", cr: "http://mlcommons.org/croissant/", dct: "http://purl.org/dc/terms/", sc: "https://schema.org/" },
    "@type": "sc:Dataset", "dct:conformsTo": "http://mlcommons.org/croissant/1.1", name: input.documentation.name,
    description: input.documentation.summary, ...(input.documentation.license ? { license: input.documentation.license } : {}),
    ...(input.documentation.languages?.length ? { inLanguage: [...input.documentation.languages] } : {}), distribution: distributions,
    recordSet: [{ "@type": "cr:RecordSet", "@id": "records", name: "records", description: `${input.totalRows} prepared training rows.`, data: distributions.map((entry) => ({ source: { fileObject: entry["@id"] } })) }],
  };
}

function isDataArtifact(artifact: DatasetVersionArtifact): boolean { return ["dataset", "train", "validation", "test"].includes(artifact.role); }
function publicationPath(artifact: DatasetVersionArtifact, index: number): string { return `data/${artifact.role}${index === 0 ? "" : `-${index + 1}`}.${mediaTypeExtension(artifact.mediaType)}`; }
function mediaTypeExtension(mediaType: string): string { if (mediaType.includes("parquet")) return "parquet"; if (mediaType.includes("csv")) return "csv"; if (mediaType.includes("ndjson") || mediaType.includes("jsonl")) return "jsonl"; if (mediaType.includes("json")) return "json"; return "bin"; }
function displayRole(role: string): string { return role.charAt(0).toUpperCase() + role.slice(1); }
function markdownItems(items: readonly string[]): string[] { return items.length ? items.map((item) => `- ${item}`) : ["- Not specified."]; }
function yamlText(value: string): string { return JSON.stringify(value); }
