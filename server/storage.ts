import { type Download, type InsertDownload, type DownloadSettings, type InsertDownloadSettings } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Downloads
  getDownload(id: string): Promise<Download | undefined>;
  getAllDownloads(): Promise<Download[]>;
  createDownload(download: InsertDownload): Promise<Download>;
  updateDownload(id: string, update: Partial<Download>): Promise<Download | undefined>;
  deleteDownload(id: string): Promise<boolean>;
  
  // Settings
  getSettings(): Promise<DownloadSettings | undefined>;
  updateSettings(settings: Partial<DownloadSettings>): Promise<DownloadSettings>;
}

export class MemStorage implements IStorage {
  private downloads: Map<string, Download>;
  private settings: DownloadSettings;

  constructor() {
    this.downloads = new Map();
    this.settings = {
      id: randomUUID(),
      maxConcurrentDownloads: 3,
      defaultThreads: 4,
      defaultOutputPath: "./downloads",
      autoStart: false,
    };
  }

  async getDownload(id: string): Promise<Download | undefined> {
    return this.downloads.get(id);
  }

  async getAllDownloads(): Promise<Download[]> {
    return Array.from(this.downloads.values()).sort((a, b) => 
      new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
    );
  }

  async createDownload(insertDownload: InsertDownload): Promise<Download> {
    const id = randomUUID();
    const now = new Date();
    const download: Download = {
      ...insertDownload,
      id,
      progress: insertDownload.progress || 0,
      speed: insertDownload.speed || 0,
      totalSegments: insertDownload.totalSegments || 0,
      downloadedSegments: insertDownload.downloadedSegments || 0,
      fileSize: insertDownload.fileSize || 0,
      downloadedBytes: insertDownload.downloadedBytes || 0,
      eta: insertDownload.eta || 0,
      threads: insertDownload.threads || 4,
      outputPath: insertDownload.outputPath || "./downloads",
      createdAt: now,
      updatedAt: now,
    };
    this.downloads.set(id, download);
    return download;
  }

  async updateDownload(id: string, update: Partial<Download>): Promise<Download | undefined> {
    const existing = this.downloads.get(id);
    if (!existing) return undefined;
    
    const updated: Download = {
      ...existing,
      ...update,
      updatedAt: new Date(),
    };
    this.downloads.set(id, updated);
    return updated;
  }

  async deleteDownload(id: string): Promise<boolean> {
    return this.downloads.delete(id);
  }

  async getSettings(): Promise<DownloadSettings | undefined> {
    return this.settings;
  }

  async updateSettings(update: Partial<DownloadSettings>): Promise<DownloadSettings> {
    this.settings = { ...this.settings, ...update };
    return this.settings;
  }
}

import { SQLiteStorage } from './sqlite-storage.js';

// Use SQLite for persistent storage
export const storage = new SQLiteStorage('./database.db');

// MemStorage is already exported above as a class declaration
