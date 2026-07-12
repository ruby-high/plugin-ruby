import { describe, expect, it } from "vitest";
import {
  DEFAULT_PULSE_INTERVAL_MINUTES,
  resolveAnalyticsSecretWithSource,
  resolveRubyTriviaApiUrl,
  resolveRubyTriviaConfig,
} from "./config.js";

function mockRuntime(settings: Record<string, string> = {}) {
  return {
    getSetting: (key: string) => settings[key],
  } as never;
}

describe("resolveRubyTriviaConfig", () => {
  it("resolves defaults and analytics secret fallback", () => {
    process.env.ANALYTICS_SECRET = "secret-from-env";
    const config = resolveRubyTriviaConfig(mockRuntime());
    expect(config.baseUrl).toBe("https://app.ruby-trivia.com");
    expect(config.analyticsSecret).toBe("secret-from-env");
    expect(config.pulseIntervalMinutes).toBe(DEFAULT_PULSE_INTERVAL_MINUTES);
    expect(config.pulseEnabled).toBe(true);
    expect(config.questionAuthoringEnabled).toBe(true);
    expect(config.questionAuthoringIntervalMinutes).toBe(60);
    expect(config.questionsPerCycle).toBe(1);
    delete process.env.ANALYTICS_SECRET;
  });

  it("prefers runtime settings over env", () => {
    process.env.RUBY_TRIVIA_API_URL = "http://env.example";
    process.env.RUBY_DISCORD_CHANNEL_ID = "env-channel";
    const config = resolveRubyTriviaConfig(
      mockRuntime({
        RUBY_TRIVIA_API_URL: "http://setting.example/",
        RUBY_ANALYTICS_SECRET: "setting-secret",
        RUBY_DISCORD_CHANNEL_ID: "setting-channel",
        RUBY_PULSE_INTERVAL_MINUTES: "10",
        RUBY_PULSE_ENABLED: "0",
      }),
    );
    expect(
      resolveRubyTriviaApiUrl(
        mockRuntime({
          RUBY_TRIVIA_API_URL: "http://setting.example/",
        }),
      ),
    ).toBe("http://setting.example");
    expect(config.analyticsSecret).toBe("setting-secret");
    expect(config.discordChannelId).toBe("setting-channel");
    expect(config.pulseIntervalMinutes).toBe(10);
    expect(config.pulseEnabled).toBe(false);
    delete process.env.RUBY_TRIVIA_API_URL;
    delete process.env.RUBY_DISCORD_CHANNEL_ID;
  });

  it("treats common truthy bool strings as enabled", () => {
    for (const value of ["1", "true", "yes", "on"]) {
      const config = resolveRubyTriviaConfig(
        mockRuntime({
          RUBY_ANALYTICS_SECRET: "secret",
          RUBY_PULSE_ENABLED: value,
        }),
      );
      expect(config.pulseEnabled).toBe(true);
    }
  });

  it("reports analytics secret source for env vs runtime setting", () => {
    process.env.RUBY_ANALYTICS_SECRET = "env-secret";
    expect(resolveAnalyticsSecretWithSource(mockRuntime())).toEqual({
      secret: "env-secret",
      source: "RUBY_ANALYTICS_SECRET (env)",
    });

    delete process.env.RUBY_ANALYTICS_SECRET;
    process.env.ANALYTICS_SECRET = "fallback-secret";
    expect(resolveAnalyticsSecretWithSource(mockRuntime())).toEqual({
      secret: "fallback-secret",
      source: "ANALYTICS_SECRET (env)",
    });
    delete process.env.ANALYTICS_SECRET;

    expect(
      resolveAnalyticsSecretWithSource(
        mockRuntime({ RUBY_ANALYTICS_SECRET: "setting-secret" }),
      ),
    ).toEqual({
      secret: "setting-secret",
      source: "RUBY_ANALYTICS_SECRET (runtime setting)",
    });
  });
});
