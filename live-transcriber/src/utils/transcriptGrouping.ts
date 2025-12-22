import type { TranscriptSegment } from "../hooks/useDualRealtime";

export const makeTranscriptGroupId = (segment: TranscriptSegment) =>
  `group-${segment.source}-${segment.itemId}`;
