export { KnowledgeModule } from './knowledge.module';
export { SearchKnowledgeUseCase, type KnowledgeSearchResult } from './application/search-knowledge.use-case';
export { IngestDocumentUseCase, type IngestDocumentInput, type IngestDocumentResult } from './application/ingest-document.use-case';
export { ListDocumentsUseCase } from './application/list-documents.use-case';
export { GetDocumentUseCase } from './application/get-document.use-case';
export { CreateDocumentUseCase, type CreateDocumentInput } from './application/create-document.use-case';
export {
  ReindexDocumentUseCase,
  type ReindexDocumentOverrides,
  type ReindexDocumentResult,
} from './application/reindex-document.use-case';
export { TestSearchUseCase, type TestSearchResult, type TestSearchCandidate } from './application/test-search.use-case';
export {
  RetrieveKnowledgeCandidatesUseCase,
  type KnowledgeCandidate,
} from './application/retrieve-knowledge-candidates.use-case';
export { KnowledgeDocumentNotFoundError } from './domain/errors/knowledge-document-not-found.error';
export { ReindexAlreadyPendingError } from './domain/errors/reindex-already-pending.error';
export { EmptyDocumentError } from './domain/errors/empty-document.error';
export { EMBEDDING_PORT, type EmbeddingPort } from './ports/embedding.port';
