/**
 * The Polyvise API's wire contracts, as TypeScript.
 *
 * The API (https://github.com/polyvise/polyvise-api) speaks camelCase JSON
 * that is field-for-field identical to these shapes; its JSON Schemas are
 * served at `GET /v1/schemas/{name}`. This file is types plus the enum lists
 * they are derived from — every validation rule and model call lives behind
 * the API.
 */

// ---------------------------------------------------------------- debates

export const debateStatuses = [
  "queued",
  "framing",
  "researching",
  "debating",
  "judging",
  "complete",
  "failed",
  "partial"
] as const;

export type DebateStatus = (typeof debateStatuses)[number];

export const topicKinds = ["policy", "value", "empirical", "decision", "comparison"] as const;

export type TopicKind = (typeof topicKinds)[number];

/**
 * The deliberation modes a run can use. Named `DebateMode` for continuity with
 * the persisted column and the existing request shape; `RunMode` in
 * `../runs/types` is the same union under the name the newer code uses.
 */
export type DebateMode = "hybrid_council" | "consensus" | "advisory_panel";
export type EvidenceMode = "cited";
export type PerspectiveSide = "pro" | "con" | "neutral";

/**
 * How many debaters per side participate in a Hybrid Council run.
 *
 * - "quartet" (default): two pro agents + two con agents + a neutral judge.
 *   This is the canonical Hybrid Council shape.
 * - "duo": one pro agent + one con agent + a neutral judge. The single pro
 *   and single con agent each speak in every round.
 */
export type CouncilSize = "duo" | "quartet";

export type DebateRound =
  | "opening"
  | "cross_examination"
  | "rebuttal"
  | "closing"
  | "judge_review"
  | "synthesis";

export interface DebateModelSelection {
  yes?: string;
  no?: string;
  quick?: string;
  deep?: string;
  judge?: string;
}

export interface DebateDevOptions {
  liveApis?: boolean;
}

/** Tuning for a `consensus` run. Ignored by the other modes. */
export interface ConsensusOptions {
  /** How many agents answer independently. 3–7, default 5. */
  agentCount?: number;
  /** Total rounds including the opening independent answer. 2–5, default 3. */
  rounds?: number;
  /**
   * Spread at or below which the panel counts as converged, 0..1. Default 0.25.
   * Raising it calls looser agreement "converged", so it is deliberately a
   * caller decision rather than a constant.
   */
  convergenceThreshold?: number;
}

/** Tuning for an `advisory_panel` run. Ignored by the other modes. */
export interface AdvisoryPanelOptions {
  /**
   * Which lenses sit on the panel. Defaults to all four. Order is preserved in
   * the rendered panel.
   */
  lenses?: Array<"economist" | "ethicist" | "operator" | "skeptic">;
}

export interface DebateRequest {
  subject: string;
  context?: string;
  mode?: DebateMode;
  evidence?: EvidenceMode;
  models?: DebateModelSelection;
  /**
   * Number of debaters per side. Defaults to "quartet" when omitted so
   * existing callers see no behavior change. Set to "duo" for a focused
   * 1-on-1 debate.
   *
   * Only meaningful when `mode` is "hybrid_council".
   */
  councilSize?: CouncilSize;
  consensus?: ConsensusOptions;
  panel?: AdvisoryPanelOptions;
  /**
   * Development-only overrides. Ignored in production.
   */
  devOptions?: DebateDevOptions;
}

export interface DebateRecord {
  id: string;
  subject: string;
  context?: string;
  mode: DebateMode;
  evidence: EvidenceMode;
  status: DebateStatus;
  resolution: string;
  topicKind: TopicKind;
  highStakes: HighStakesNotice | null;
  createdAt: string;
  updatedAt: string;
  latestRun?: DebateRun;
  productNotes: ProductNote[];
  followups: FollowupExchange[];
}

export interface DebateRun {
  id: string;
  debateId: string;
  status: DebateStatus;
  startedAt: string;
  completedAt?: string;
  /**
   * The council shape this run actually used. Optional because runs persisted
   * before this field existed cannot report it.
   */
  councilSize?: CouncilSize;
  events: DebateEvent[];
  scouts: StanceScout[];
  teams: DebateTeam;
  sources: EvidenceSource[];
  claims: Claim[];
  argumentNodes: ArgumentNode[];
  argumentEdges: ArgumentEdge[];
  turns: RoundTurn[];
  scorecard: Scorecard;
  summary: DebateSummary;
  modelSnapshots: ModelSnapshot[];
  artifactManifest: RunArtifact[];
  trace: RunTraceEntry[];
  /**
   * Which parts of this run are deterministic filler rather than model output.
   *
   * The live event stream carries a per-step `placeholder`, but a consumer
   * reading a stored run has no other way to tell: fallback turns sit in
   * `turns` looking exactly like real ones. Anything named here MUST NOT be
   * presented as a real answer.
   *
   * Optional because runs persisted before this field existed cannot report
   * it — absent means "unknown", not "nothing fell back".
   */
  placeholders?: RunPlaceholders;
}

/**
 * Deterministic-fallback markers for a whole run, keyed by the step that fell
 * back. Turns are keyed by round, so one failed round doesn't discard the
 * rounds that succeeded.
 */
export interface RunPlaceholders {
  scouts?: PlaceholderInfo;
  claims?: PlaceholderInfo;
  turns?: Partial<Record<DebateRound, PlaceholderInfo>>;
  scorecard?: PlaceholderInfo;
  summary?: PlaceholderInfo;
}

export interface DebateEvent {
  id: string;
  debateId: string;
  runId: string;
  status: DebateStatus;
  label: string;
  detail: string;
  createdAt: string;
}

export interface StanceScout {
  id: string;
  name: string;
  model: string;
  lens: string;
  side: PerspectiveSide;
  thesis: string;
  assumptions: string[];
  strongestArguments: string[];
}

export interface DebateAgent {
  id: string;
  name: string;
  side: Exclude<PerspectiveSide, "neutral">;
  model: string;
  role: string;
  thesis: string;
}

export interface DebateTeam {
  pro: DebateAgent[];
  con: DebateAgent[];
  judge: {
    id: string;
    name: string;
    model: string;
    role: string;
  };
}

export interface EvidenceSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
  snippet: string;
  quality: "primary" | "expert" | "methodology" | "context";
  retrievedVia: "brave" | "mock" | "tavily";
  status: "accepted" | "needs_review" | "rejected";
}

export interface Claim {
  id: string;
  side: PerspectiveSide;
  text: string;
  warrant: string;
  evidenceSourceIds: string[];
  confidence: number;
}

export interface ArgumentNode {
  id: string;
  kind: "resolution" | "claim" | "evidence" | "uncertainty" | "summary";
  side: PerspectiveSide;
  label: string;
  detail: string;
  sourceId?: string;
}

export interface ArgumentEdge {
  id: string;
  source: string;
  target: string;
  relation: "supports" | "challenges" | "qualifies" | "summarizes";
}

export interface RoundTurn {
  id: string;
  round: DebateRound;
  agentId: string;
  agentName: string;
  side: PerspectiveSide;
  content: string;
  claimIds: string[];
  sourceIds: string[];
  createdAt: string;
  /**
   * The model that actually wrote this turn. Only set when a real model call
   * produced it — a turn left over from a fallback batch has no model to name,
   * and claiming one would be worse than leaving it blank.
   */
  model?: string;
}

export interface Scorecard {
  recommendation: "conditional_yes" | "lean_yes" | "mixed" | "lean_no" | "conditional_no";
  confidence: number;
  categories: Array<{
    name: "evidence" | "practicality" | "risk" | "fairness" | "reversibility";
    pro: number;
    con: number;
    note: string;
  }>;
}

export interface DebateSummary {
  headline: string;
  recommendation: string;
  strongestPro: string[];
  strongestCon: string[];
  unresolvedUncertainties: string[];
  whatWouldChangeMind: string[];
  confidence: number;
  highStakesDisclaimer?: string;
}

export interface ModelSnapshot {
  id: string;
  provider: "openai" | "anthropic" | "google" | "openrouter" | "local";
  model: string;
  role: string;
  configured: boolean;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCostUsd?: number;
  failure?: string;
  attempts?: ModelCallAttempt[];
}

export interface ModelCallAttempt {
  attempt: number;
  mode: "json_schema" | "json_object";
  status: "ok" | "failed";
  durationMs: number;
  message?: string;
}

export interface RunArtifact {
  id: string;
  /**
   * Artifact kinds across every mode. `scouts` through `scorecard` are the
   * debate's; `positions` and `convergence` belong to consensus, `lenses`,
   * `advice` and `synthesis` to the advisory panel.
   */
  kind:
    | "run_state"
    | "scouts"
    | "evidence"
    | "claims"
    | "turns"
    | "scorecard"
    | "summary"
    | "models"
    | "positions"
    | "convergence"
    | "lenses"
    | "advice"
    | "synthesis";
  label: string;
  recordCount: number;
  createdAt: string;
}

export interface ProductNote {
  id: string;
  title: string;
  mode: "debate_showcase" | "model_lab";
  note: string;
  priority: "later" | "research" | "candidate";
}

export interface FollowupExchange {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface UserFeedback {
  id: string;
  app: string;
  message: string;
  debateId?: string;
  pagePath?: string;
  userAgent?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RunTraceEntry {
  id: string;
  /**
   * Steps from every mode share one union so a single trace viewer can render
   * any run. The debate steps come first; `answer` through `chair` belong to
   * consensus and the advisory panel.
   */
  step:
    | "frame"
    | "scout"
    | "team_builder"
    | "evidence"
    | "opening"
    | "cross_exam"
    | "rebuttal"
    | "closing"
    | "judge_review"
    | "judge"
    | "persist"
    | "panel_builder"
    | "answer"
    | "revise"
    | "converge"
    | "advise"
    | "chair";
  status: "ok" | "warning" | "failed";
  message: string;
  at: string;
  durationMs?: number;
}

export interface HighStakesNotice {
  category: "medical" | "legal" | "financial" | "safety";
  message: string;
}

/**
 * A step that fell back to deterministic placeholder content because the
 * configured LLM either failed or returned an unusable response.
 *
 * When this is present on an event, the data payload IS the deterministic
 * fallback and MUST NOT be presented to the user as a real answer.
 */
export interface PlaceholderInfo {
  /** Model id that was supposed to run this step. */
  requestedModel: string;
  /** Human-readable explanation of why the call failed. */
  reason: string;
}

export type DebateLiveEvent =
  | { kind: "stage"; status: DebateStatus }
  | { kind: "framed"; resolution: string; topicKind: TopicKind; highStakes: HighStakesNotice | null }
  | { kind: "scouts"; scouts: StanceScout[]; placeholder?: PlaceholderInfo }
  | { kind: "teams"; teams: DebateTeam }
  | { kind: "sources"; sources: EvidenceSource[] }
  | { kind: "claims"; claims: Claim[]; placeholder?: PlaceholderInfo }
  | { kind: "argument_map"; nodes: ArgumentNode[]; edges: ArgumentEdge[] }
  | { kind: "turns"; round: DebateRound; turns: RoundTurn[]; placeholder?: PlaceholderInfo }
  | { kind: "scorecard"; scorecard: Scorecard; placeholder?: PlaceholderInfo }
  | { kind: "summary"; summary: DebateSummary; placeholder?: PlaceholderInfo }
  | { kind: "model_snapshot"; snapshot: ModelSnapshot }
  | { kind: "complete"; runId: string }
  | { kind: "error"; message: string };

// ------------------------------------------------- run envelopes and modes


/**
 * Every deliberation mode Polyvise can run.
 *
 * The three differ in what they produce, not in how a run is operated: all of
 * them frame a resolution, gather evidence, call models with retries, record a
 * trace, and mark deterministic fallbacks. That shared operation lives in
 * `RunEnvelope`; the part that actually differs lives in `RunResult`.
 *
 * Aliases `DebateMode`, which stays the canonical union because the request
 * shape and the persisted column both already use that name.
 */
export type RunMode = DebateMode;

/**
 * The mode-independent record of a run.
 *
 * Deliberately excludes anything that only one mode has. A consensus run has
 * no judge and an advisory panel has no opposing sides, so neither belongs
 * here — they live in the mode's own result, where the field names can be
 * honest about what they hold.
 */
export interface RunEnvelope<TResult extends RunResult = RunResult> {
  id: string;
  debateId: string;
  status: DebateStatus;
  startedAt: string;
  completedAt?: string;
  events: DebateEvent[];
  /** Graded evidence. Shared because every mode reasons from the same ledger. */
  sources: EvidenceSource[];
  modelSnapshots: ModelSnapshot[];
  artifactManifest: RunArtifact[];
  trace: RunTraceEntry[];
  /**
   * Which parts of this run are deterministic filler rather than model output.
   * Absent means "unknown", not "nothing fell back".
   */
  placeholders?: RunPlaceholders;
  result: TResult;
}

/** Discriminated on `mode`, so narrowing a run narrows its whole shape. */
export type RunResult = HybridCouncilResult | ConsensusResult | AdvisoryPanelResult;

/* ------------------------------------------------------------------ debate */

/**
 * The Hybrid Council payload, field-for-field what `DebateRun` has carried at
 * its top level since before the envelope existed. `toDebateRun` flattens this
 * back out for callers still on the old shape.
 */
export interface HybridCouncilResult {
  mode: "hybrid_council";
  councilSize?: CouncilSize;
  scouts: StanceScout[];
  teams: DebateTeam;
  claims: Claim[];
  argumentNodes: ArgumentNode[];
  argumentEdges: ArgumentEdge[];
  turns: RoundTurn[];
  scorecard: Scorecard;
  summary: DebateSummary;
}

/* --------------------------------------------------------------- consensus */

/**
 * A consensus agent has a lens but no side. That is the whole point of the
 * mode: nobody is assigned a position to defend, so convergence means
 * something.
 */
export interface ConsensusAgent {
  id: string;
  name: string;
  model: string;
  lens: string;
}

/**
 * Where an agent stands relative to the resolution, on a fixed ordinal scale.
 *
 * Prose answers cannot be compared across agents, so convergence is measured
 * on this instead: it maps to a number, which makes spread computable from the
 * positions rather than something a model gets to assert about itself.
 */
export const consensusStances = [
  "strongly_agree",
  "agree",
  "neutral",
  "disagree",
  "strongly_disagree"
] as const;

export type ConsensusStance = (typeof consensusStances)[number];

/** One agent's answer at one round. */
export interface ConsensusPosition {
  id: string;
  agentId: string;
  agentName: string;
  /** 1-based. Round 1 is the independent answer, before anyone sees the others. */
  round: number;
  stance: ConsensusStance;
  answer: string;
  rationale: string;
  /** 0..1 — the agent's own stated confidence, not a measure of agreement. */
  confidence: number;
  /**
   * Whether this agent's stance moved from its previous round. False in round
   * 1, where there is nothing to move from. Derived by comparing stances, not
   * taken on the model's word.
   */
  changedFromPrevious: boolean;
  sourceIds: string[];
  /** Only set when a real model call wrote this position. */
  model?: string;
}

export interface ConsensusRound {
  round: number;
  positions: ConsensusPosition[];
  /**
   * 0..1 disagreement across the panel at the end of this round. 0 is total
   * agreement. Computed from the positions, never asked of a model.
   */
  spread: number;
}

export interface ConsensusConvergence {
  /** True when the final spread is at or under the convergence threshold. */
  converged: boolean;
  finalAnswer: string;
  /** 0..1, the inverse of the final round's spread. */
  agreementLevel: number;
  /** Prose description of the range the panel settled into. */
  range: string;
  /** Spread after each round, so a caller can chart the convergence curve. */
  spreadByRound: number[];
}

/**
 * An agent whose final stance still differs from the panel's modal stance.
 *
 * Reported separately because "four agreed and one refused to budge" is a
 * materially different result from "five agreed", and an average hides it. Use
 * `ConsensusPosition.changedFromPrevious` for movement over rounds; this is
 * specifically about who was still outside the majority at the end.
 */
export interface ConsensusHoldout {
  agentId: string;
  agentName: string;
  stance: ConsensusStance;
  position: string;
  reason: string;
}

export interface ConsensusSummary {
  headline: string;
  finding: string;
  agreed: string[];
  contested: string[];
  unresolvedUncertainties: string[];
  /** 0..100, to match DebateSummary. */
  confidence: number;
  highStakesDisclaimer?: string;
}

export interface ConsensusResult {
  mode: "consensus";
  agents: ConsensusAgent[];
  rounds: ConsensusRound[];
  convergence: ConsensusConvergence;
  holdouts: ConsensusHoldout[];
  summary: ConsensusSummary;
}

/* ------------------------------------------------------------------- panel */

export const panelLensIds = ["economist", "ethicist", "operator", "skeptic"] as const;

export type PanelLensId = (typeof panelLensIds)[number];

export interface PanelLens {
  id: PanelLensId;
  name: string;
  model: string;
  /** What this lens is asked to weigh, in one line. */
  brief: string;
}

/**
 * One lens's advice, given without seeing the others. The panel is additive
 * rather than adversarial: these are four independent readings, not four
 * positions in an argument.
 */
export interface PanelAdvice {
  id: string;
  lensId: PanelLensId;
  lensName: string;
  recommendation: string;
  reasoning: string;
  keyRisks: string[];
  /** What would have to be true for this lens to endorse the decision. */
  conditions: string[];
  /** 0..1 */
  confidence: number;
  sourceIds: string[];
  /** Only set when a real model call wrote this advice. */
  model?: string;
}

export interface PanelAgreement {
  point: string;
  lensIds: PanelLensId[];
}

/**
 * A point the panel splits on. Keeping each lens's stance rather than a single
 * summary line is the difference between reporting a conflict and flattening
 * it into false agreement.
 */
export interface PanelConflict {
  point: string;
  positions: Array<{ lensId: PanelLensId; stance: string }>;
}

export interface PanelChairSynthesis {
  headline: string;
  throughLine: string;
  agreements: PanelAgreement[];
  conflicts: PanelConflict[];
  decisionGuidance: string;
  /** 0..100, to match DebateSummary. */
  confidence: number;
  highStakesDisclaimer?: string;
}

export interface AdvisoryPanelResult {
  mode: "advisory_panel";
  lenses: PanelLens[];
  advice: PanelAdvice[];
  chair: PanelChairSynthesis;
}

/* ----------------------------------------------------------------- aliases */

export type DebateRunEnvelope = RunEnvelope<HybridCouncilResult>;
export type ConsensusRunEnvelope = RunEnvelope<ConsensusResult>;
export type AdvisoryPanelRunEnvelope = RunEnvelope<AdvisoryPanelResult>;

export function isHybridCouncilRun(run: RunEnvelope): run is DebateRunEnvelope {
  return run.result.mode === "hybrid_council";
}

export function isConsensusRun(run: RunEnvelope): run is ConsensusRunEnvelope {
  return run.result.mode === "consensus";
}

export function isAdvisoryPanelRun(run: RunEnvelope): run is AdvisoryPanelRunEnvelope {
  return run.result.mode === "advisory_panel";
}

// ------------------------------------------------------------ live events

/** A subject as the engine understood it, before any model is called. */
export interface FramedDebate {
  subject: string;
  context?: string;
  resolution: string;
  topicKind: TopicKind;
  highStakes: HighStakesNotice | null;
}

/**
 * Live events for a consensus run. Separate from `DebateLiveEvent` because the
 * payloads genuinely differ — there are no teams, turns or scorecard here.
 */
export type ConsensusLiveEvent =
  | { kind: "stage"; status: ConsensusRunEnvelope["status"] }
  | { kind: "framed"; resolution: string; topicKind: FramedDebate["topicKind"]; highStakes: FramedDebate["highStakes"] }
  | { kind: "agents"; agents: ConsensusAgent[]; placeholder?: PlaceholderInfo }
  | { kind: "sources"; sources: EvidenceSource[] }
  | { kind: "round"; round: ConsensusRound; placeholder?: PlaceholderInfo }
  | { kind: "convergence"; convergence: ConsensusConvergence }
  | { kind: "summary"; summary: ConsensusSummary; holdouts: ConsensusHoldout[]; placeholder?: PlaceholderInfo }
  | { kind: "model_snapshot"; snapshot: ModelSnapshot }
  | { kind: "complete"; runId: string }
  | { kind: "error"; message: string };

export type AdvisoryPanelLiveEvent =
  | { kind: "stage"; status: AdvisoryPanelRunEnvelope["status"] }
  | { kind: "framed"; resolution: string; topicKind: FramedDebate["topicKind"]; highStakes: FramedDebate["highStakes"] }
  | { kind: "lenses"; lenses: PanelLens[] }
  | { kind: "sources"; sources: EvidenceSource[] }
  | { kind: "advice"; advice: PanelAdvice; placeholder?: PlaceholderInfo }
  | { kind: "chair"; chair: PanelChairSynthesis; placeholder?: PlaceholderInfo }
  | { kind: "model_snapshot"; snapshot: ModelSnapshot }
  | { kind: "complete"; runId: string }
  | { kind: "error"; message: string };

// ---------------------------------------------------------- model catalog

export type ModelProvider =
  | "anthropic"
  | "deepseek"
  | "google"
  | "moonshot"
  | "openai"
  | "xai"
  | "zai";

export type ModelSpeed = "fast" | "balanced" | "deliberate";
export type ModelTier = "economy" | "standard" | "premium";
export type ModelCompatibility = "supported" | "experimental";

export interface AvailableModel {
  id: string;
  label: string;
  provider: ModelProvider;
  speed: ModelSpeed;
  tier: ModelTier;
  reasoning: boolean;
  compatibility: ModelCompatibility;
  compatibilityNote?: string;
  notes?: string;
}
