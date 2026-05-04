import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const healthMetricReadings = sqliteTable("health_metric_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  category: text("category").notNull(),
  metric: text("metric").notNull(),
  unit: text("unit").notNull(),
  value: text("value").notNull(),
  recordedAt: text("recorded_at").notNull(),
  confidence: integer("confidence").notNull(),
});

export const insertHealthMetricReadingSchema = createInsertSchema(healthMetricReadings).omit({
  id: true,
});

export const dashboardFilterSchema = z.object({
  range: z.enum(["24h", "7d", "30d", "90d"]).default("30d"),
  mode: z.enum(["mock", "databricks"]).default("mock"),
});

export type InsertHealthMetricReading = z.infer<typeof insertHealthMetricReadingSchema>;
export type HealthMetricReading = typeof healthMetricReadings.$inferSelect;
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
