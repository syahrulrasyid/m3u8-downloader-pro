import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { M3U8Parser } from "./services/m3u8-parser";
import { DownloadEngine } from "./services/download-engine";
import { insertDownloadSchema } from "@shared/schema";
import type { WebSocketMessage } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set<WebSocket>();
  
  // Download engine instance
  const downloadEngine = new DownloadEngine((message: WebSocketMessage) => {
    broadcast(message);
  });

  // Broadcast message to all connected clients
  function broadcast(message: WebSocketMessage) {
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    clients.add(ws);
    
    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  // API Routes

  // Get all downloads
  app.get('/api/downloads', async (req, res) => {
    try {
      const downloads = await storage.getAllDownloads();
      res.json(downloads);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch downloads' });
    }
  });

  // Detect M3U8 URLs from a webpage
  app.post('/api/detect-m3u8', async (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        return res.status(400).json({ message: 'URL is required' });
      }

      console.log(`Detecting M3U8 URLs from: ${url}`);
      const detections = await M3U8Parser.detectM3U8FromPage(url);
      
      console.log(`Found ${detections.length} M3U8 detections`);
      res.json({ 
        m3u8Urls: detections.map(d => d.url), // Legacy format
        detections // New detailed format
      });
    } catch (error) {
      console.error('M3U8 detection error:', error);
      res.status(500).json({ message: 'Failed to detect M3U8 URLs' });
    }
  });

  // Add new download
  app.post('/api/downloads', async (req, res) => {
    try {
      const validatedData = insertDownloadSchema.parse(req.body);
      
      if (!validatedData.m3u8Url) {
        return res.status(400).json({ message: 'M3U8 URL is required' });
      }

      // Parse M3U8 playlist
      const playlist = await M3U8Parser.parsePlaylist(validatedData.m3u8Url);
      
      // Estimate file size (rough calculation)
      const estimatedFileSize = playlist.segments.length * 1024 * 1024; // 1MB per segment estimate

      const download = await storage.createDownload({
        ...validatedData,
        totalSegments: playlist.segments.length,
        fileSize: estimatedFileSize,
        segments: playlist.segments,
      });

      // Auto-start if enabled
      const settings = await storage.getSettings();
      if (settings?.autoStart) {
        await downloadEngine.startDownload(download.id);
      }

      res.json(download);
    } catch (error) {
      console.error('Error creating download:', error);
      res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid download data' });
    }
  });

  // Start download
  app.post('/api/downloads/:id/start', async (req, res) => {
    try {
      const { id } = req.params;
      await downloadEngine.startDownload(id);
      res.json({ message: 'Download started' });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to start download' });
    }
  });

  // Pause download
  app.post('/api/downloads/:id/pause', async (req, res) => {
    try {
      const { id } = req.params;
      await downloadEngine.pauseDownload(id);
      res.json({ message: 'Download paused' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to pause download' });
    }
  });

  // Cancel download
  app.post('/api/downloads/:id/cancel', async (req, res) => {
    try {
      const { id } = req.params;
      await downloadEngine.cancelDownload(id);
      res.json({ message: 'Download cancelled' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to cancel download' });
    }
  });

  // Delete download
  app.delete('/api/downloads/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await downloadEngine.cancelDownload(id);
      const deleted = await storage.deleteDownload(id);
      
      if (!deleted) {
        return res.status(404).json({ message: 'Download not found' });
      }
      
      res.json({ message: 'Download deleted' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete download' });
    }
  });

  // Get download statistics
  app.get('/api/stats', async (req, res) => {
    try {
      const downloads = await storage.getAllDownloads();
      const stats = {
        totalDownloads: downloads.length,
        activeDownloads: downloads.filter(d => d.status === 'downloading').length,
        completedDownloads: downloads.filter(d => d.status === 'completed').length,
        failedDownloads: downloads.filter(d => d.status === 'error').length,
        totalSpeed: downloads
          .filter(d => d.status === 'downloading')
          .reduce((sum, d) => sum + (d.speed || 0), 0)
      };
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch statistics' });
    }
  });

  // Get settings
  app.get('/api/settings', async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch settings' });
    }
  });

  // Update settings
  app.put('/api/settings', async (req, res) => {
    try {
      const settings = await storage.updateSettings(req.body);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update settings' });
    }
  });

  // Retry merge for completed downloads that failed merging
  app.post('/api/downloads/:id/retry-merge', async (req, res) => {
    try {
      const { id } = req.params;
      const download = await storage.getDownload(id);
      
      if (!download) {
        return res.status(404).json({ message: 'Download not found' });
      }
      
      if (download.status !== 'completed' && download.status !== 'error') {
        return res.status(400).json({ message: 'Download must be completed or failed to retry merge' });
      }
      
      await downloadEngine.retryMerge(id);
      res.json({ message: 'Merge retry initiated' });
    } catch (error) {
      console.error('Error retrying merge:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to retry merge' });
    }
  });

  return httpServer;
}
