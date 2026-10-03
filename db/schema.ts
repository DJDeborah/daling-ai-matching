import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  profileId: text("profile_id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  name: text("name").notNull(), gender: text("gender").notNull(), seeking: text("seeking").notNull(),
  age: integer("age").notNull(), minAge: integer("min_age").notNull(), maxAge: integer("max_age").notNull(),
  city: text("city").notNull(), preferredCity: text("preferred_city").notNull(),
  heightCm: integer("height_cm"), preferredHeightMin: integer("preferred_height_min"), preferredHeightMax: integer("preferred_height_max"),
  bodyType: text("body_type").notNull(), preferredBodyType: text("preferred_body_type").notNull(),
  school: text("school").notNull(), mbti: text("mbti").notNull(), zodiac: text("zodiac").notNull(),
  preferredZodiac: text("preferred_zodiac").notNull(), interestsJson: text("interests_json").notNull(),
  about: text("about").notNull(), partnerNote: text("partner_note").notNull(),
  matchingJson: text("matching_json").notNull().default('{"version":2,"depth":{"version":1,"topics":{}}}'),
  contactKind: text("contact_kind").notNull(), contactValue: text("contact_value").notNull(),
  contactShare: integer("contact_share").notNull(), visible: integer("visible").notNull(),
  adultConfirmedAt: text("adult_confirmed_at").notNull(), poolConsentedAt: text("pool_consented_at"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, table => [index("profiles_visible_updated_idx").on(table.visible, table.updatedAt)]);

export const likes = sqliteTable("likes", {
  fromProfileId: text("from_profile_id").notNull(),
  toProfileId: text("to_profile_id").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [primaryKey({ columns: [table.fromProfileId, table.toProfileId] }), index("likes_to_idx").on(table.toProfileId)]);

export const blocks = sqliteTable("blocks", {
  fromProfileId: text("from_profile_id").notNull(),
  toProfileId: text("to_profile_id").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [primaryKey({ columns: [table.fromProfileId, table.toProfileId] }), index("blocks_to_idx").on(table.toProfileId)]);

export const likeEvents = sqliteTable("like_events", {
  eventId: text("event_id").primaryKey(),
  fromProfileId: text("from_profile_id").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("like_events_from_created_idx").on(table.fromProfileId, table.createdAt)]);

export const users = sqliteTable("users", {
  userId: text("user_id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, table => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  bucket: text("bucket").primaryKey(),
  hits: integer("hits").notNull(),
  resetAt: text("reset_at").notNull(),
});

export const aiUsage = sqliteTable("ai_usage", {
  eventId: text("event_id").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [index("ai_usage_user_created_idx").on(table.userId, table.createdAt)]);

export const conversations = sqliteTable("conversations", {
  userId: text("user_id").primaryKey(),
  turn: integer("turn").notNull(),
  step: integer("step").notNull(),
  status: text("status").notNull(),
  draftJson: text("draft_json").notNull(),
  messagesJson: text("messages_json").notNull(),
  updatedAt: text("updated_at").notNull(),
  protocolVersion: integer("protocol_version").notNull().default(1),
  questionText: text("question_text").notNull().default(""),
});

export const matchReports = sqliteTable("match_reports", {
  userId: text("user_id").primaryKey(),
  profileUpdatedAt: text("profile_updated_at").notNull(),
  demoVersion: integer("demo_version").notNull(),
  reportJson: text("report_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const draftMatchReports = sqliteTable("draft_match_reports", {
  userId: text("user_id").primaryKey().references(() => users.userId, { onDelete: "cascade" }),
  profileUpdatedAt: text("profile_updated_at").notNull(),
  demoVersion: integer("demo_version").notNull(),
  reportJson: text("report_json").notNull(),
  createdAt: text("created_at").notNull(),
});
