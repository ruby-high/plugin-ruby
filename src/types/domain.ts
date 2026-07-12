/**
 * Domain object types for the Ruby Trivia admin API catalog.
 * Mirrors docs/API-OBJECTS.md — summary / listing / detail views per noun.
 *
 * WHY types/domain.ts separate from types/admin.ts:
 * - admin.ts: raw HTTP response shapes from the trivia server.
 * - domain.ts: operator-facing nouns + view models used by formatters and catalog.
 */
export type {
  CommunityDifficulty,
  CommunityOverview,
  HappeningTimelineItem,
  PlatformHappenings,
  PublishDailyResult,
  TriviaHealthResponse,
} from "./admin.js";

export type DomainLayer =
  | "platform"
  | "community"
  | "players"
  | "content"
  | "dailies"
  | "achievements"
  | "meta";

export type DomainObjectKind =
  | "service_health"
  | "platform_happenings"
  | "happening_timeline_item"
  | "live_snapshot"
  | "live_room"
  | "community_overview"
  | "community_difficulty"
  | "weak_category"
  | "user"
  | "user_knowledge_profile"
  | "sm2_row"
  | "question"
  | "question_bank"
  | "published_daily"
  | "daily_publish_result"
  | "daily_revoke_result"
  | "achievement_definition"
  | "achievement_group"
  | "earned_badge"
  | "active_challenge"
  | "user_achievement_stats"
  | "agent_doc";

export type WeakCategoryDetail = {
  category: string;
  meanEasiness: number;
  questions?: number;
};

export type DifficultyTierRow = {
  difficulty: string;
  accuracy: number;
  attempts: number;
};

export type LiveRoom = {
  roomId: string;
  phase: string;
  playerCount: number;
  createdAt: string;
};

export type LiveSnapshot = {
  queueWaiting: number;
  activeRooms: number;
  rooms: LiveRoom[];
};

export type CachedTimelineItem = {
  kind: "analytics" | "crew";
  at: string;
  event: string;
  displayName: string | null;
  summary: string;
};

export type User = {
  id: string;
  displayName: string;
  /** Present on admin list/detail — stripped before operator-facing payloads. */
  email?: string;
  createdAt: string;
  learnGoals?: string;
  xp: number;
  level: number;
  totalPoints: number;
  lastPlayedDate: string | null;
  totalTracked: number;
};

export type UserListResponse = {
  users: User[];
  total: number;
  limit: number;
  offset: number;
};

export type Sm2Row = {
  user_id?: string;
  question_id: string;
  category: string;
  difficulty: string;
  easiness: number;
  interval_days?: number;
  repetitions?: number;
  due_at?: string | null;
  seen_count?: number;
  correct_count?: number;
};

export type UserKnowledgeUser = {
  id: string;
  displayName: string;
  learnGoals?: string;
  xp: number;
  level: number;
  totalPoints: number;
  streak: number;
  lastPlayedDate: string | null;
};

export type UserKnowledgeProfile = {
  user: UserKnowledgeUser;
  profile?: {
    weakCategories?: Array<{
      category: string;
      meanEasiness: number;
      questions: number;
    }>;
    totalTracked?: number;
    dueQuestions?: unknown[];
  };
  weakCategories?: string[];
  sm2Sample?: Sm2Row[];
  dueQuestions?: unknown[];
};

/** Shape of GET /api/admin/users/:id/knowledge */
export type UserKnowledgeApiResponse = {
  user: UserKnowledgeUser & { email?: string };
  profile: {
    weakCategories: Array<{
      category: string;
      meanEasiness: number;
      questions: number;
    }>;
    totalTracked: number;
    dueQuestions?: unknown[];
  };
  sm2Sample: Sm2Row[];
  dueQuestions: unknown[];
};

export type Question = {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation?: string;
  source?: string;
  status?: string;
  language?: string;
  culture?: string;
  translationSuitable?: boolean;
};

export type QuestionListResponse = {
  count: number;
  questions: Question[];
};

export type PublishedDaily = {
  id?: string;
  date: string;
  scope: "community" | "user";
  userId?: string | null;
  gameId?: string;
  questionIds: string[];
  notes?: string;
  publishedAt?: string;
};

export type DailyListResponse = {
  publishes: PublishedDaily[];
};

export type DailyRevokeResult = {
  revokedAt: string;
  affectedUsersEstimate: number;
};

export type AchievementDefinition = {
  id: string;
  gameId: string;
  name: string;
  description: string;
  icon?: string;
  trigger: string;
  condition?: unknown;
  tier?: number;
  groupId?: string | null;
  hidden?: boolean;
  sortOrder?: number;
  earnedCount?: number;
};

export type AchievementGroup = {
  id: string;
  gameId: string;
  name: string;
  description?: string;
  masteryBadgeId?: string;
  memberIds?: string[];
  members?: Array<{ id: string; name: string; tier?: number }>;
};

export type ActiveChallenge = {
  id: string;
  userId: string;
  achievementId: string;
  name: string;
  assignedDate: string;
  progress: number;
  target: number;
  completed: boolean;
  completedAt: string | null;
  assignedBy: string;
};

export type AgentDoc = {
  slug: string;
  path: string;
  content: string;
  updatedAt: string;
};

export type DomainObjectMeta = {
  kind: DomainObjectKind;
  layer: DomainLayer;
  label: string;
  summary: string;
  rubyOp: string | null;
  cached: boolean;
  cacheTtlMinutes: number | null;
};
