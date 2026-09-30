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
