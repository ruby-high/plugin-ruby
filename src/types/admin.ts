export type TriviaHealthResponse = {
  ok?: boolean;
  ai?: {
    enabled?: boolean;
    reachable?: boolean;
    model?: string;
  };
};

export type HappeningTimelineItem = {
  kind: "analytics" | "crew";
  at: string;
  event: string;
  userId: string | null;
  displayName: string | null;
  summary: string;
  data: Record<string, unknown>;
};

export type PlatformHappenings = {
  generatedAt: string;
  since: string;
  until: string;
  summary: {
    timelineCount: number;
    analyticsEventCounts: Record<string, number>;
    crewActivityCount: number;
    liveQueueWaiting: number;
    activeLiveRooms: number;
    registrations: number;
    dailyCompletions: number;
    badgeEarns: number;
  };
  live: {
    queueWaiting: number;
    activeRooms: number;
    rooms: Array<{
      roomId: string;
      phase: string;
      playerCount: number;
      createdAt: string;
    }>;
  };
  timeline?: HappeningTimelineItem[];
};

export type CommunityOverview = {
  overview?: Record<string, unknown>;
  friction?: Record<string, unknown>;
  difficulty?: Array<{
    difficulty: string;
    accuracy: number;
    attempts: number;
  }>;
  weakCategories?: Array<{ category: string; meanEasiness?: number }>;
};

export type CommunityDifficulty = {
  byDifficulty?: Array<{
    difficulty: string;
    accuracy: number;
    attempts: number;
  }>;
  weakCategories?: Array<{
    category: string;
    meanEasiness: number;
    questions: number;
  }>;
};

export type PublishDailyResult = {
  id?: string;
  date?: string;
  scope?: string;
  userId?: string | null;
  questionIds?: string[];
  notes?: string;
  difficultyBreakdown?: Record<string, number>;
  warnings?: string[];
};

export type RubyFetchError = {
  ok: false;
  kind: "network" | "timeout" | "http";
  status?: number;
  message: string;
};

export type RubyFetchSuccess<T> = {
  ok: true;
  data: T;
  status: number;
};

export type RubyFetchResult<T> = RubyFetchSuccess<T> | RubyFetchError;
