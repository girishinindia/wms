/** Words for dispatch order and LR states — safe for the browser. */
export const DO_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_VERIFICATION: "Needs details",
  READY_FOR_OUTWARD: "Ready to load",
  LOADING_IN_PROGRESS: "Loading",
  LOADED: "Loaded",
  DISPATCHED: "Dispatched",
  ON_HOLD: "On hold",
  CANCELLED: "Cancelled",
};

export const LR_LABEL: Record<string, string> = {
  NOT_DUE: "—",
  PENDING: "LR pending",
  COLLECTED: "LR collected",
  SUBMITTED: "LR with manager",
  UPLOADED: "LR attached",
  VERIFIED: "LR verified",
  REJECTED: "LR rejected",
  MISSING: "LR missing",
};
