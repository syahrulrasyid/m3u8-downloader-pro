import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import { storage } from '../storage';
import { VideoMerger, type MergeOptions } from './video-merger';
import type { WebSocketMessage, Download } from '@shared/schema';

export interface DownloadTask {
  downloadId: string;
  segments: string[];
  outputPath: string;
  filename: string;
  threads: number;
}

export class DownloadEngine {
  private activeDownloads: Map<string, boolean> = new Map();
  private downloadStats: Map<string, {
    startTime: number;
    downloadedBytes: number;
    totalBytes: number;
  }> = new Map();
  private segmentFiles: Map<string, string[]> = new Map(); // Track segment file paths per download
  private failedSegments: Map<string, Set<number>> = new Map(); // Track failed segment indices per download
  private completionThreshold = 0.98; // Consider download complete at 98%

  constructor(private onProgress: (message: WebSocketMessage) => void) {
    // Initialize VideoMerger on startup
    VideoMerger.checkFFmpegAvailability().then(available => {
      if (available) {
        console.log('VideoMerger initialized successfully');
      } else {
        console.warn('VideoMerger not available - FFmpeg not found');
      }
    });
  }

  async startDownload(downloadId: string): Promise<void> {
    const download = await storage.getDownload(downloadId);
    if (!download || !download.segments) {
      throw new Error('Download not found or no segments available');
    }

    // Update status to downloading
    await storage.updateDownload(downloadId, { status: 'downloading' });
    
    const segments = download.segments as string[];
    
    console.log(`Starting/resuming download ${downloadId} with ${segments.length} total segments`);
    
    // Check for existing segments (smart resume)
    const { existingSegments, missingSegments, existingSegmentPaths } = await this.checkExistingSegments(download, segments);
    
    console.log(`Found ${existingSegments.length} existing segments, need to download ${missingSegments.length} missing segments`);
    
    // Update progress based on existing segments
    if (existingSegments.length > 0) {
      const progress = (existingSegments.length / segments.length) * 100;
      await storage.updateDownload(downloadId, {
        downloadedSegments: existingSegments.length,
        progress: Math.round(progress * 100) / 100
      });
    }
    
    // Initialize download stats
    this.downloadStats.set(downloadId, {
      startTime: Date.now(),
      downloadedBytes: download.downloadedBytes || 0,
      totalBytes: download.fileSize || 0,
    });

    // Initialize segment files tracking with existing segments
    this.segmentFiles.set(downloadId, existingSegmentPaths);
    
    // Initialize failed segments tracking
    this.failedSegments.set(downloadId, new Set());

    // Create output directory
    await fs.mkdir(download.outputPath, { recursive: true });

    // Mark as active
    this.activeDownloads.set(downloadId, true);
    
    // Emit initial status update
    this.onProgress({
      type: 'download_status',
      downloadId,
      status: 'downloading'
    });

    // If all segments exist, go straight to completion check
    if (missingSegments.length === 0) {
      console.log(`All segments already downloaded for ${downloadId}, checking completion...`);
      await this.checkDownloadCompletion(downloadId);
      return;
    }

    // Start download process only for missing segments
    this.processDownload(downloadId, missingSegments, segments.length).catch((error) => {
      console.error(`Download ${downloadId} failed:`, error);
      this.handleDownloadError(downloadId, error.message);
    });
  }

  async pauseDownload(downloadId: string): Promise<void> {
    this.activeDownloads.set(downloadId, false);
    
    await storage.updateDownload(downloadId, { status: 'paused' });
    this.onProgress({
      type: 'download_status',
      downloadId,
      status: 'paused'
    });
  }

  async cancelDownload(downloadId: string): Promise<void> {
    this.activeDownloads.delete(downloadId);
    await storage.updateDownload(downloadId, { status: 'cancelled' });
    this.downloadStats.delete(downloadId);
    
    // Clean up segment files and failed segments tracking
    this.segmentFiles.delete(downloadId);
    this.failedSegments.delete(downloadId);
    
    this.onProgress({
      type: 'download_status',
      downloadId,
      status: 'cancelled'
    });
  }

  private async processDownload(downloadId: string, missingSegments: {index: number, url: string}[], totalSegments: number): Promise<void> {
    const download = await storage.getDownload(downloadId);
    if (!download) return;

    const maxConcurrency = download.threads || 8;
    console.log(`Starting parallel download of ${missingSegments.length} missing segments (${totalSegments} total) with ${maxConcurrency} concurrent connections`);
    
    // Create concurrency limiter
    const limit = this.createConcurrencyLimiter(maxConcurrency);
    const downloadPromises = missingSegments.map((segmentInfo) => 
      limit(async () => {
        // Check if download is still active
        if (!this.activeDownloads.get(downloadId)) {
          throw new Error('Download paused or cancelled');
        }

        try {
          const segmentSize = await this.downloadSegment(segmentInfo.url, segmentInfo.index, download);
          await this.updateDownloadProgress(downloadId, segmentInfo.index, segmentSize, totalSegments);
          return segmentSize;
        } catch (error) {
          console.error(`Failed to download segment ${segmentInfo.index}:`, error);
          // Track failed segment
          const failedSet = this.failedSegments.get(downloadId) || new Set();
          failedSet.add(segmentInfo.index);
          this.failedSegments.set(downloadId, failedSet);
          throw error;
        }
      })
    );

    try {
      const results = await Promise.allSettled(downloadPromises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log(`Download completed: ${successful}/${missingSegments.length} missing segments successful, ${failed} failed`);
      
      if (failed > 0) {
        const errors = results.filter(r => r.status === 'rejected').map((r: any) => r.reason);
        console.error('Failed segments:', errors.slice(0, 5)); // Show first 5 errors
      }
    } catch (error) {
      console.error('Error in parallel download:', error);
    }

    await this.checkDownloadCompletion(downloadId);
  }
  
  private createConcurrencyLimiter(limit: number) {
    const queue: Array<() => void> = [];
    let running = 0;

    return function<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        queue.push(async () => {
          try {
            running++;
            const result = await fn();
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            running--;
            if (queue.length > 0 && running < limit) {
              const next = queue.shift();
              if (next) next();
            }
          }
        });

        if (running < limit) {
          const next = queue.shift();
          if (next) next();
        }
      });
    };
  }

  private async downloadSegment(segmentUrl: string, segmentIndex: number, download: Download): Promise<number> {
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(segmentUrl, {
          responseType: 'arraybuffer',
          timeout: 15000, // Reduced timeout for faster failure detection
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Referer': segmentUrl.split('/').slice(0, 3).join('/')
          }
        });

        if (!response.data || response.data.byteLength === 0) {
          throw new Error(`Empty response for segment ${segmentIndex}`);
        }

        const segmentPath = path.join(download.outputPath, `${download.filename}_segment_${segmentIndex}.ts`);
        await fs.writeFile(segmentPath, response.data);
        
        // Track segment file path
        const segmentFiles = this.segmentFiles.get(download.id) || [];
        segmentFiles.push(segmentPath);
        this.segmentFiles.set(download.id, segmentFiles);
        
        return response.data.byteLength; // Return actual segment size
      } catch (error) {
        lastError = error;
        console.error(`Error downloading segment ${segmentIndex} (attempt ${attempt}/${maxRetries}):`, error instanceof Error ? error.message : error);
        
        if (attempt < maxRetries) {
          // Wait before retry with exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
        }
      }
    }
    
    throw new Error(`Failed to download segment ${segmentIndex} after ${maxRetries} attempts: ${lastError}`);
  }

  private async updateDownloadProgress(downloadId: string, segmentIndex: number, segmentSize: number, totalSegments?: number) {
    const download = await storage.getDownload(downloadId);
    if (!download) return;

    const stats = this.downloadStats.get(downloadId);
    if (!stats) return;

    stats.downloadedBytes += segmentSize;
    
    const newDownloadedSegments = (download.downloadedSegments || 0) + 1;
    const totalSegs = totalSegments || download.totalSegments || 1;
    const progress = (newDownloadedSegments / totalSegs) * 100;
    
    // Calculate speed (bytes per second)
    const elapsedSeconds = (Date.now() - stats.startTime) / 1000;
    const speed = elapsedSeconds > 0 ? stats.downloadedBytes / elapsedSeconds : 0;
    
    // Calculate ETA based on remaining missing segments
    const failedSegments = this.failedSegments.get(downloadId)?.size || 0;
    const remainingSegments = totalSegs - newDownloadedSegments - failedSegments;
    const avgSegmentTime = elapsedSeconds / (newDownloadedSegments - (download.downloadedSegments || 0) + 1);
    const eta = remainingSegments > 0 && avgSegmentTime > 0 ? Math.round(remainingSegments * avgSegmentTime) : 0;

    await storage.updateDownload(downloadId, {
      downloadedSegments: newDownloadedSegments,
      progress: Math.round(progress * 100) / 100,
      downloadedBytes: stats.downloadedBytes,
      speed,
      eta
    });

    this.onProgress({
      type: 'download_progress',
      downloadId,
      progress,
      downloadedSegments: newDownloadedSegments,
      speed,
      eta,
      downloadedBytes: stats.downloadedBytes
    });
  }

  private async checkDownloadCompletion(downloadId: string) {
    const download = await storage.getDownload(downloadId);
    if (!download) return;

    const downloadedSegments = download.downloadedSegments || 0;
    const totalSegments = download.totalSegments || 1;
    const failedSegments = this.failedSegments.get(downloadId)?.size || 0;
    const progress = downloadedSegments / totalSegments;
    
    console.log(`Download ${downloadId}: ${downloadedSegments}/${totalSegments} segments (${Math.round(progress * 100)}%), ${failedSegments} failed`);
    
    // Conditions for completion:
    // 1. All segments downloaded successfully
    // 2. OR progress is above threshold (98%) and we have enough segments for a watchable video
    // 3. OR only a few segments are missing and they've all failed multiple times
    const shouldComplete = 
      downloadedSegments >= totalSegments || // All segments downloaded
      (progress >= this.completionThreshold && downloadedSegments > 0) || // Above threshold with some segments
      (downloadedSegments + failedSegments >= totalSegments && failedSegments <= Math.max(2, totalSegments * 0.02)); // Most segments attempted, few failed
    
    if (shouldComplete) {
      const finalProgress = Math.min(100, Math.round(progress * 100));
      
      console.log(`Completing download ${downloadId} with ${downloadedSegments}/${totalSegments} segments (${finalProgress}%)`);
      
      await storage.updateDownload(downloadId, { 
        status: 'completed', 
        progress: finalProgress
      });
      
      // Merge segments into final video file
      await this.mergeSegments(downloadId);
      
      // Clean up tracking
      this.activeDownloads.delete(downloadId);
      this.downloadStats.delete(downloadId);
      this.failedSegments.delete(downloadId);
      
      this.onProgress({
        type: 'download_status',
        downloadId,
        status: 'completed'
      });
    }
  }

  // Add retry mechanism for failed merges
  async retryMerge(downloadId: string): Promise<void> {
    const download = await storage.getDownload(downloadId);
    if (!download) {
      throw new Error('Download not found');
    }

    // Check if all segments are still available on disk
    const segmentFiles = this.segmentFiles.get(downloadId) || [];
    if (segmentFiles.length === 0) {
      // Try to reconstruct segment file paths
      const reconstructedPaths = [];
      for (let i = 0; i < (download.totalSegments || 0); i++) {
        const segmentPath = path.join(download.outputPath, `${download.filename}_segment_${i}.ts`);
        try {
          await fs.access(segmentPath);
          reconstructedPaths.push(segmentPath);
        } catch (error) {
          console.warn(`Segment file missing: ${segmentPath}`);
        }
      }
      this.segmentFiles.set(downloadId, reconstructedPaths);
    }

    console.log(`Retrying merge for download ${downloadId}`);
    await this.mergeSegments(downloadId);
  }

  private async mergeSegments(downloadId: string) {
    const download = await storage.getDownload(downloadId);
    if (!download) {
      console.error(`Download ${downloadId} not found for merging`);
      return;
    }

    const segmentFiles = this.segmentFiles.get(downloadId) || [];
    if (segmentFiles.length === 0) {
      console.error(`No segment files found for download ${downloadId}`);
      return;
    }

    console.log(`Starting merge of ${segmentFiles.length} segments for download ${downloadId}`);
    
    // Emit merge start status
    this.onProgress({
      type: 'download_status',
      downloadId,
      status: 'merging'
    });

    await storage.updateDownload(downloadId, { status: 'merging' });

    try {
      const mergeOptions: MergeOptions = {
        outputPath: download.outputPath,
        filename: download.filename,
        segmentPaths: segmentFiles,
        onProgress: (progress: number) => {
          this.onProgress({
            type: 'merge_progress',
            downloadId,
            progress
          });
        }
      };

      // Try FFmpeg merge first, fall back to binary merge if FFmpeg is not available
      let result;
      try {
        console.log('Attempting FFmpeg merge...');
        result = await VideoMerger.mergeSegmentsToMKV(mergeOptions);
      } catch (ffmpegError) {
        console.warn('FFmpeg merge failed, falling back to binary concatenation:', ffmpegError instanceof Error ? ffmpegError.message : ffmpegError);
        
        this.onProgress({
          type: 'download_status',
          downloadId,
          status: 'merging',
          message: 'FFmpeg not available, using binary merge...'
        });
        
        result = await VideoMerger.mergeSegmentsBinary(mergeOptions);
      }

      if (result.success) {
        console.log(`Successfully merged segments to: ${result.outputFile}`);
        
        // Update download record with final file info
        await storage.updateDownload(downloadId, { 
          status: 'completed',
          outputFile: result.outputFile,
          duration: result.duration
        });
        
        // Clean up segment tracking
        this.segmentFiles.delete(downloadId);
        
        this.onProgress({
          type: 'download_status',
          downloadId,
          status: 'completed',
          outputFile: result.outputFile
        });
      } else {
        throw new Error(result.error || 'Unknown merge error');
      }
    } catch (error) {
      console.error(`Error merging segments for download ${downloadId}:`, error);
      
      // Even if merge fails, the segments are still available
      await storage.updateDownload(downloadId, { 
        status: 'completed', // Mark as completed since download succeeded
        errorMessage: `Merge failed but segments available: ${error instanceof Error ? error.message : error}`,
        progress: 100
      });
      
      this.onProgress({
        type: 'download_status',
        downloadId,
        status: 'completed',
        errorMessage: `Merge failed but segments downloaded: ${error instanceof Error ? error.message : error}`
      });
    }
  }

  private async handleDownloadError(downloadId: string, error: string) {
    await storage.updateDownload(downloadId, { 
      status: 'error', 
      errorMessage: error 
    });
    
    this.activeDownloads.delete(downloadId);
    this.downloadStats.delete(downloadId);
    
    this.onProgress({
      type: 'download_status',
      downloadId,
      status: 'error',
      errorMessage: error
    });
  }
  
  private async checkExistingSegments(download: Download, allSegments: string[]) {
    const existingSegments: {index: number, url: string}[] = [];
    const missingSegments: {index: number, url: string}[] = [];
    const existingSegmentPaths: string[] = [];
    
    console.log(`Checking ${allSegments.length} segments for existing files...`);
    
    for (let i = 0; i < allSegments.length; i++) {
      const segmentUrl = allSegments[i];
      const segmentPath = path.join(download.outputPath, `${download.filename}_segment_${i}.ts`);
      
      try {
        // Check if segment file exists and has content
        const stats = await fs.stat(segmentPath);
        if (stats.size > 0) {
          existingSegments.push({index: i, url: segmentUrl});
          existingSegmentPaths.push(segmentPath);
        } else {
          // File exists but is empty, consider it missing
          console.warn(`Segment file ${segmentPath} exists but is empty, will re-download`);
          missingSegments.push({index: i, url: segmentUrl});
        }
      } catch (error) {
        // File doesn't exist
        missingSegments.push({index: i, url: segmentUrl});
      }
    }
    
    console.log(`Segment check complete: ${existingSegments.length} existing, ${missingSegments.length} missing`);
    
    return {
      existingSegments,
      missingSegments,
      existingSegmentPaths
    };
  }
}

