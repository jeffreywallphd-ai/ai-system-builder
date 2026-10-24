import { createInMemoryStructuredDocumentStore } from "../in-memory-structured-document-store";
import { structuredTransactionConformance } from "./structured-transaction-conformance";

structuredTransactionConformance("in-memory", () => {
  const documents = createInMemoryStructuredDocumentStore();
  return {documents, alias: documents, close() {}};
});
