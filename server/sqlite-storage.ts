import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { type Download, type InsertDownload, type DownloadSettings, type InsertDownloadSettings } from '@shared/schema';
import { randomUUID } from 'crypto';
import { IStorage } from './storage.js';

export class SQLiteStorage implements IStorage {
  private db: sqlite3.Database;
  private dbRun: (sql: string, params?: any[]) => Promise<sqlite3.RunResult>;
  private dbGet: (sql: string, params?: any[]) => Promise<any>;
  private dbAll: (sql: string, params?: any[]) => Promise<any[]>;

  constructor(dbPath: string = './database.db') {
    this.db = new sqlite3.Database(dbPath);
    
    // Promisify database methods
    this.dbRun = promisify(this.db.run.bind(this.db));
    this.dbGet = promisify(this.db.get.bind(this.db));
    this.dbAll = promisify(this.db.all.bind(this.db));
    
    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      // Create downloads table
      await this.dbRun(`
        CREATE TABLE IF NOT EXISTS downloads (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          m3u8Url TEXT NOT NULL,
          filename TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          progress REAL DEFAULT 0,
          speed REAL DEFAULT 0,
          totalSegments INTEGER DEFAULT 0,
          downloadedSegments INTEGER DEFAULT 0,
          fileSize INTEGER DEFAULT 0,
          downloadedBytes INTEGER DEFAULT 0,
          eta INTEGER DEFAULT 0,
          threads INTEGER DEFAULT 4,
          outputPath TEXT DEFAULT './downloads',
          outputFile TEXT,
          duration REAL,
          errorMessage TEXT,
          segments TEXT, -- JSON string for segment URLs
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        )
      `);

      // Create settings table
      await this.dbRun(`
        CREATE TABLE IF NOT EXISTS settings (
          id TEXT PRIMARY KEY,
          maxConcurrentDownloads INTEGER DEFAULT 3,
          defaultThreads INTEGER DEFAULT 4,
          defaultOutputPath TEXT DEFAULT './downloads',
          autoStart BOOLEAN DEFAULT false
        )
      `);

      // Create default settings if not exists
      const existingSettings = await this.dbGet('SELECT * FROM settings LIMIT 1');
      if (!existingSettings) {
        await this.dbRun(`
          INSERT INTO settings (id, maxConcurrentDownloads, defaultThreads, defaultOutputPath, autoStart)
          VALUES (?, ?, ?, ?, ?)
        `, [randomUUID(), 3, 4, './downloads', false]);
      }

      console.log('✅ SQLite database initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize SQLite database:', error);
      throw error;
    }
  }

  async getDownload(id: string): Promise<Download | undefined> {
    try {
      const row = await this.dbGet('SELECT * FROM downloads WHERE id = ?', [id]);
      return row ? this.deserializeDownload(row) : undefined;
    } catch (error) {
      console.error('Error getting download:', error);
      return undefined;
    }
  }

  async getAllDownloads(): Promise<Download[]> {
    try {
      const rows = await this.dbAll('SELECT * FROM downloads ORDER BY createdAt DESC');
      return rows.map(row => this.deserializeDownload(row));
    } catch (error) {
      console.error('Error getting all downloads:', error);
      return [];
    }
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
      outputPath: insertDownload.outputPath || './downloads',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.dbRun(`
        INSERT INTO downloads (
          id, url, m3u8Url, filename, status, progress, speed, totalSegments,
          downloadedSegments, fileSize, downloadedBytes, eta, threads, outputPath,
          outputFile, duration, errorMessage, segments, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        download.id, download.url, download.m3u8Url, download.filename,
        download.status, download.progress, download.speed, download.totalSegments,
        download.downloadedSegments, download.fileSize, download.downloadedBytes,
        download.eta, download.threads, download.outputPath, download.outputFile,
        download.duration, download.errorMessage,
        download.segments ? JSON.stringify(download.segments) : null,
        download.createdAt.toISOString(), download.updatedAt.toISOString()
      ]);

      return download;
    } catch (error) {
      console.error('Error creating download:', error);
      throw error;
    }
  }

  async updateDownload(id: string, update: Partial<Download>): Promise<Download | undefined> {
    try {
      const existing = await this.getDownload(id);
      if (!existing) return undefined;

      const updated: Download = {
        ...existing,
        ...update,
        updatedAt: new Date(),
      };

      await this.dbRun(`
        UPDATE downloads SET
          url = ?, m3u8Url = ?, filename = ?, status = ?, progress = ?, speed = ?,
          totalSegments = ?, downloadedSegments = ?, fileSize = ?, downloadedBytes = ?,
          eta = ?, threads = ?, outputPath = ?, outputFile = ?, duration = ?,
          errorMessage = ?, segments = ?, updatedAt = ?
        WHERE id = ?
      `, [
        updated.url, updated.m3u8Url, updated.filename, updated.status,
        updated.progress, updated.speed, updated.totalSegments, updated.downloadedSegments,
        updated.fileSize, updated.downloadedBytes, updated.eta, updated.threads,
        updated.outputPath, updated.outputFile, updated.duration, updated.errorMessage,
        updated.segments ? JSON.stringify(updated.segments) : null,
        updated.updatedAt.toISOString(), id
      ]);

      return updated;
    } catch (error) {
      console.error('Error updating download:', error);
      return undefined;
    }
  }

  async deleteDownload(id: string): Promise<boolean> {
    try {
      const result = await this.dbRun('DELETE FROM downloads WHERE id = ?', [id]);
      return (result.changes || 0) > 0;
    } catch (error) {
      console.error('Error deleting download:', error);
      return false;
    }
  }

  async getSettings(): Promise<DownloadSettings | undefined> {
    try {
      const row = await this.dbGet('SELECT * FROM settings LIMIT 1');
      return row ? {
        id: row.id,
        maxConcurrentDownloads: row.maxConcurrentDownloads,
        defaultThreads: row.defaultThreads,
        defaultOutputPath: row.defaultOutputPath,
        autoStart: Boolean(row.autoStart),
      } : undefined;
    } catch (error) {
      console.error('Error getting settings:', error);
      return undefined;
    }
  }

  async updateSettings(update: Partial<DownloadSettings>): Promise<DownloadSettings> {
    try {
      const existing = await this.getSettings();
      if (!existing) {
        throw new Error('Settings not found');
      }

      const updated: DownloadSettings = { ...existing, ...update };

      await this.dbRun(`
        UPDATE settings SET
          maxConcurrentDownloads = ?, defaultThreads = ?, defaultOutputPath = ?, autoStart = ?
        WHERE id = ?
      `, [
        updated.maxConcurrentDownloads, updated.defaultThreads,
        updated.defaultOutputPath, updated.autoStart ? 1 : 0, existing.id
      ]);

      return updated;
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  }

  private deserializeDownload(row: any): Download {
    return {
      id: row.id,
      url: row.url,
      m3u8Url: row.m3u8Url,
      filename: row.filename,
      status: row.status,
      progress: row.progress,
      speed: row.speed,
      totalSegments: row.totalSegments,
      downloadedSegments: row.downloadedSegments,
      fileSize: row.fileSize,
      downloadedBytes: row.downloadedBytes,
      eta: row.eta,
      threads: row.threads,
      outputPath: row.outputPath,
      outputFile: row.outputFile,
      duration: row.duration,
      errorMessage: row.errorMessage,
      segments: row.segments ? JSON.parse(row.segments) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
          reject(err);
        } else {
          console.log('Database connection closed');
          resolve();
        }
      });
    });
  }
}