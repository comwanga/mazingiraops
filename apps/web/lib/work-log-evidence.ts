import {
  EVIDENCE_MAX_PER_STAGE,
  type EvidenceStage,
} from "@ward-ops/contracts";

export { EVIDENCE_MAX_PER_STAGE };

export interface EvidenceFileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export type EvidenceFileSelection<T extends EvidenceFileIdentity = File> = Record<
  EvidenceStage,
  T[]
>;

export function createEvidenceFileSelection<T extends EvidenceFileIdentity = File>(): EvidenceFileSelection<T> {
  return { BEFORE: [], DURING: [], AFTER: [] };
}

function fileKey(file: EvidenceFileIdentity): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function addEvidenceFiles<T extends EvidenceFileIdentity>(
  current: T[],
  incoming: T[],
): { files: T[]; rejectedCount: number } {
  const unique = new Map(current.map((file) => [fileKey(file), file]));
  let duplicateCount = 0;

  for (const file of incoming) {
    const key = fileKey(file);
    if (unique.has(key)) {
      duplicateCount += 1;
    } else {
      unique.set(key, file);
    }
  }

  const candidates = [...unique.values()];
  return {
    files: candidates.slice(0, EVIDENCE_MAX_PER_STAGE),
    rejectedCount: duplicateCount + Math.max(0, candidates.length - EVIDENCE_MAX_PER_STAGE),
  };
}
