import { z } from 'zod';

export const id = z.uuid();
export const revision = z.number().int().positive();
export const label = z.string().trim().min(1).max(500);
export type Identity = { id: string; sessionId: string; clientId?: string; permission: 'read' | 'write'; accessToken?: string };
export type Provenance = { kind: 'source' | 'translation' | 'interpretation' | 'controversy' | 'example' | 'reflection'; references: string[]; limitations: string[] };
export type Profile = { id: string; creatorId: string; holderId: string | null; creatorAccess: boolean; visibility: 'private' | 'public'; fields: Record<string, string>; revision: number };
export type SourceBlock = { id: string; kind: 'heading' | 'paragraph' | 'quote' | 'verse' | 'list' | 'table' | 'figure' | 'code' | 'equation' | 'note' | 'unknown' | 'navigation'; text: string; locator?: string; meta: Record<string, unknown> };
export const anchorSchema = z.strictObject({
  sourceId: id, sourceRevision: revision, elementId: label,
  start: z.number().int().nonnegative(), end: z.number().int().positive(), exact: z.string().min(1),
  prefix: z.string().default(''), suffix: z.string().default(''), locator: z.string().optional()
}).refine(a => a.end > a.start, {message: 'Intervalo vazio ou invertido.'});
export type Anchor = z.infer<typeof anchorSchema>;
export type Source = {
  id: string; revision: number; ownerId: string; workId: string | null; editionId: string | null;
  title: string; language: string; nature: 'original' | 'translation' | 'commentary' | 'bibliography';
  extent: 'full' | 'fragment' | 'reference'; authors: {name: string; role: 'author' | 'translator' | 'editor' | 'commentator'}[];
  rights: {status: 'public-domain' | 'licensed' | 'permission' | 'private-use'; statement: string; evidence: string; offlineAllowed: boolean};
  originalFile: string | null; bodyFile: string; /** Canonical revision bytes. */ sha256: string; /** Original acquisition bytes, used for deduplication. */ originalSha256: string; metadata: Record<string, unknown>;
};
export type DocumentLink = {id: string; from: Anchor[]; to: Anchor[]; relation: 'supports' | 'interprets' | 'contrasts' | 'illustrates'; provenance: Provenance};
export type Condition = {questionId: string; operator: 'equals' | 'in' | 'present'; values?: string[]};
export type Question = {id: string; type: 'single_choice' | 'multiple_choice' | 'text'; prompt: string; required: boolean; options?: {id: string; label: string}[]; showWhen?: Condition; familiarityReferences?: string[]};
export type Answers = Record<string, string | string[]>;
export type FormDefinition = {id: string; revision: number; projectId: string; profileId: string; questions: Question[]; purposeByQuestion: Record<string, string>; planningReference: string; maxQuestions: number};
export type Submission = {id: string; formId: string; formRevision: number; revision: number; profileId: string; respondentId: string; projectId: string; answers: Answers; submittedAt: string};
export type Project = {id: string; ownerId: string; title: string; object: {kind: 'work' | 'theme'; workIds: string[]; subject: string}; scope: string; sourceIds: string[]; language: string; audience: string; baseState: 'preparing' | 'producing' | 'available' | 'correcting'; activeRevision: number | null; configuration: {editorial: Record<string, unknown>; instructional: Record<string, unknown>}; revision: number};
export type Participation = {id: string; projectId: string; profileId: string; state: 'invited' | 'form_available' | 'submitted' | 'producing' | 'available' | 'stale'; formId: string | null; submissionId: string | null; activeRevision: number | null};
export type Coverage = {id: string; description: string; unitIds: string[]; sourceAnchors: Anchor[]; practiceIds: string[]; gap?: string};
export type StudyUnit = {id: string; title: string; body: string; references: DocumentLink[]; knowledgeTargets: string[]; provenance: Provenance[]; appliedConfiguration?: Record<string, unknown>};
export type Resource = {id: string; projectId: string; baseRevision: number; profileId: string | null; unitId?: string; type: string; title: string; purpose: string; targets: Anchor[]; body: string; sources: Anchor[]; appliedConfiguration: Record<string, unknown>; inspection: 'pending' | 'ai_inspected';};
// Stored and authorized separately: never include in the shared reader manifest.
export type PersonalizationReason = {resourceId: string; submissionId: string; submissionRevision: number; questionIds: string[]; rationale: string};
export type Choice = {id: string; revision: number; unitId: string; profileId: string; position: number; prompt: string; options: {id: string; text: string; feedback: string}[]; correctOptionId: string; coverageTargets: string[]; sources: Anchor[]; appliedConfiguration?: Record<string, unknown>};
export type Attempt = {id: string; profileId: string; questionId: string; questionRevision: number; sequenceId: string; optionId: string; correct: boolean; snapshot: Choice; createdAt: string};
export type ContentBundle = {projectId: string; revision: number; profileId: string | null; baseRevision: number; units: StudyUnit[]; resources: Resource[]; choices: Choice[]; coverage: Coverage[]; inspection: {kind: 'ai'; references: string[]; findings: string[]; completed: boolean};};
export type FileEntry = {path: string; sha256: string; bytes: number; mediaType: string; offlineAllowed: boolean};
export type Manifest = {format: 'um-package/1'; projectId: string; revision: number; profileId: string | null; files: FileEntry[]; sourceRevisions: Record<string, number>; publishedAt: string};
export type ReaderTab = {id: string; kind: 'unit' | 'resource' | 'sources' | 'source'; title: string; objectId: string; revision: number; position: number; origin: Anchor | null; anchor: Anchor | null; anchorStatus?: 'verified' | 'needs_review'};
export type ReaderState = {projectId: string; profileId: string; unitId: string; tabs: ReaderTab[]; activeTabId: string; revision: number};
export type OperationState = 'local' | 'pending' | 'confirmed' | 'error' | 'conflict' | 'uncertain';
export type Receipt<T = unknown> = {operationId: string; status: 'confirmed'; result: T; committedAt: string};
export type QueuedOperation = {id: string; accountId: string; profileId: string; task: string; arguments: Record<string, unknown>; state: OperationState; createdAt: string; error?: string};
export type CatalogEntry = {id: string; kind: 'method' | 'resource'; name: string; purpose: string; conditions: string[]; limits: string[]; instructions: string; references: string[]; type: string; revision: number; disabled?: boolean};
export type LibraryEntity = {id: string; kind: 'author' | 'work' | 'edition' | 'concept' | 'place' | 'period' | 'tradition' | 'discipline' | 'art'; labels: Record<string, string>; aliases: string[]; authorIds: string[]; authorship?: 'individual' | 'multiple' | 'collective' | 'attributed' | 'unknown'; regions: string[]; traditions: string[]; disciplines: string[]; periods: string[]; dates: {start: number | null; end: number | null; approximate: boolean; original?: string; evidence?: string}; locations: {lat: number; lon: number; role: 'birth' | 'activity' | 'composition' | 'conservation'; evidence: string; dates?: string}[]; metadata: Record<string, unknown>};
export type LibraryRelation = {id: string; from: string; to: string; type: 'influence' | 'reception' | 'criticism' | 'opposition' | 'continuity' | 'affinity' | 'broader' | 'exactMatch' | 'closeMatch'; evidence: string[]};
export type Observation = {id: string; projectId: string; authorId: string; target: Anchor; text: string; status: 'open' | 'addressed' | 'unchanged'; result: string | null};
export const operationInput = z.strictObject({operationId: id});
