export const contentTypes = ["talk", "flow", "glossary", "price", "manual", "legal", "video", "roleplay"] as const;

export type ContentType = (typeof contentTypes)[number];

export interface LegacySourceRef {
  repository: string;
  file: string;
  variable: string | null;
  captured_at: string;
  source_sha256: string;
}

export interface ContentSummary {
  id: string;
  legacyId: string;
  type: ContentType;
  category: string;
  title: string;
  tags: string[];
  difficulty?: string | number | null;
  publicationState: string;
  availabilityState?: "restricted" | "pilot" | "published";
  reviewStatus?: string;
  migrationState?: string;
  requiresReview?: boolean;
  aiEligible?: boolean;
}

export interface ContentDetail extends ContentSummary {
  version?: number;
  body: string;
  legacyPayload: Record<string, unknown>;
  sourceRef: LegacySourceRef;
  originalHash: string;
  migrationState: string;
  reviewReason: string;
}

export interface ContentQuery {
  type?: ContentType[];
  category?: string[];
  tags?: string[];
  text?: string;
  page: number;
  pageSize: number;
}

export interface ContentRepository {
  counts(): Promise<Record<ContentType, number>>;
  search(query: ContentQuery): Promise<{ items: ContentSummary[]; total: number; hasMore: boolean }>;
  get(id: string): Promise<ContentDetail | null>;
  related(id: string, limit: number): Promise<ContentSummary[]>;
}
