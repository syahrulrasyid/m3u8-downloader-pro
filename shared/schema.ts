import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, json, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const downloads = pgTable("downloads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  url: text("url").notNull(),
  m3u8Url: text("m3u8_url"),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("queued"), // queued, downloading, paused, completed, error
  progress: real("progress").notNull().default(0), // 0-100
  totalSegments: integer("total_segments").default(0),
  downloadedSegments: integer("downloaded_segments").default(0),
  fileSize: integer("file_size").default(0), // in bytes
  downloadedBytes: integer("downloaded_bytes").default(0),
  speed: real("speed").default(0), // bytes per second
  eta: integer("eta").default(0), // seconds
  threads: integer("threads").default(4),
  outputPath: text("output_path").notNull().default("./downloads"),
  errorMessage: text("error_message"),
  segments: json("segments").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const downloadSettings = pgTable("download_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  maxConcurrentDownloads: integer("max_concurrent_downloads").default(3),
  defaultThreads: integer("default_threads").default(4),
  defaultOutputPath: text("default_output_path").default("./downloads"),
  autoStart: boolean("auto_start").default(false),
});

export const insertDownloadSchema = createInsertSchema(downloads).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDownloadSettingsSchema = createInsertSchema(downloadSettings).omit({
  id: true,
});

export type Download = typeof downloads.$inferSelect;
export type InsertDownload = z.infer<typeof insertDownloadSchema>;
export type DownloadSettings = typeof downloadSettings.$inferSelect;
export type InsertDownloadSettings = z.infer<typeof insertDownloadSettingsSchema>;

// WebSocket message types
export interface DownloadProgressMessage {
  type: "download_progress";
  downloadId: string;
  progress: number;
  downloadedSegments: number;
  speed: number;
  eta: number;
  downloadedBytes: number;
}

export interface DownloadStatusMessage {
  type: "download_status";
  downloadId: string;
  status: string;
  errorMessage?: string;
}

export interface StatsMessage {
  type: "stats_update";
  totalDownloads: number;
  activeDownloads: number;
  completedDownloads: number;
  failedDownloads: number;
  totalSpeed: number;
}

export type WebSocketMessage = DownloadProgressMessage | DownloadStatusMessage | StatsMessage;
