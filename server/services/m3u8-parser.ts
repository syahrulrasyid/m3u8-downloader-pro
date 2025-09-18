import axios from 'axios';
import puppeteer, { Page } from 'puppeteer';

export interface M3U8Playlist {
  url: string;
  segments: string[];
  totalDuration: number;
  isLive: boolean;
}

export interface M3U8Detection {
  url: string;
  quality?: string;
  resolution?: string;
  bandwidth?: number;
}

export class M3U8Parser {
  private static userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
  ];

  private static getRandomUserAgent(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  static async detectM3U8FromPage(pageUrl: string): Promise<M3U8Detection[]> {
    console.log(`Starting M3U8 detection for: ${pageUrl}`);
    
    try {
      // Try multiple detection methods
      let detections: M3U8Detection[] = [];
      
      // Method 1: Direct M3U8 URL handling
      if (pageUrl.toLowerCase().includes('.m3u8')) {
        detections = await this.handleDirectM3U8(pageUrl);
        if (detections.length > 0) return detections;
      }
      
      // Method 2: Static content analysis
      detections = await this.detectFromStaticContent(pageUrl);
      if (detections.length > 0) return detections;
      
      // Method 3: Browser automation with network interception
      detections = await this.detectWithBrowser(pageUrl);
      return detections;
      
    } catch (error) {
      console.error('Error detecting M3U8 URLs:', error);
      return [];
    }
  }
  
  private static async handleDirectM3U8(url: string): Promise<M3U8Detection[]> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.getRandomUserAgent()
        }
      });
      
      const content = response.data;
      
      if (content.includes('#EXT-X-STREAM-INF')) {
        // Master playlist - extract variants
        return this.parseMasterPlaylist(content, url);
      } else {
        // Media playlist
        return [{ url }];
      }
    } catch (error) {
      console.error('Error handling direct M3U8:', error);
      return [];
    }
  }
  
  private static parseMasterPlaylist(content: string, baseUrl: string): M3U8Detection[] {
    const detections: M3U8Detection[] = [];
    const lines = content.split('\n').map(line => line.trim());
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('#EXT-X-STREAM-INF') && i + 1 < lines.length) {
        const streamUrl = lines[i + 1].trim();
        
        if (streamUrl && !streamUrl.startsWith('#')) {
          // Parse quality info
          const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          
          const absoluteUrl = streamUrl.startsWith('http') 
            ? streamUrl 
            : new URL(streamUrl, baseUrl).href;
            
          detections.push({
            url: absoluteUrl,
            resolution: resolutionMatch ? resolutionMatch[1] : undefined,
            bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : undefined
          });
        }
      }
    }
    
    return detections;
  }
  
  private static async detectFromStaticContent(pageUrl: string): Promise<M3U8Detection[]> {
    try {
      const response = await axios.get(pageUrl, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Referer': pageUrl
        }
      });
      
      const content = response.data;
      const detections: M3U8Detection[] = [];
      
      // Enhanced regex patterns for M3U8 detection
      const patterns = [
        // Standard M3U8 URLs
        /(https?:\/\/[^\s"'<>(){}\[\]]+\.m3u8(?:[^\s"'<>(){}\[\]])*)/gi,
        // M3U8 in quotes
        /["']([^"']*\.m3u8[^"']*)["']/gi,
        // Base64 encoded (common obfuscation)
        /["']([A-Za-z0-9+\/]{20,}={0,2})["']/g,
        // JavaScript variable assignments
        /(?:src|url|link|stream|video)\s*[:=]\s*["']([^"']*m3u8[^"']*)["']/gi,
        // JSON embedded URLs
        /"(?:src|url|link|stream|video)"\s*:\s*"([^"]*m3u8[^"]*)"/gi
      ];
      
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const candidate = match[1];
          
          if (candidate.includes('.m3u8')) {
            detections.push({ url: candidate });
          } else if (candidate.length > 20 && /^[A-Za-z0-9+\/]+={0,2}$/.test(candidate)) {
            // Try to decode base64
            try {
              const decoded = Buffer.from(candidate, 'base64').toString();
              if (decoded.includes('.m3u8')) {
                detections.push({ url: decoded });
              }
            } catch (e) {
              // Ignore decode errors
            }
          }
        }
      }
      
      // Look in script tags specifically
      const scriptMatches = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
      if (scriptMatches) {
        for (const script of scriptMatches) {
          const scriptContent = script.replace(/<\/?script[^>]*>/g, '');
          const urls = this.extractFromScript(scriptContent);
          detections.push(...urls);
        }
      }
      
      // Remove duplicates and invalid URLs
      const uniqueDetections = detections.filter((detection, index, self) => 
        index === self.findIndex(d => d.url === detection.url)
      ).filter(detection => this.isValidM3U8Url(detection.url));
      
      return uniqueDetections;
      
    } catch (error) {
      console.error('Error in static content detection:', error);
      return [];
    }
  }
  
  private static extractFromScript(scriptContent: string): M3U8Detection[] {
    const detections: M3U8Detection[] = [];
    
    // Look for various patterns in JavaScript
    const jsPatterns = [
      /["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/gi,
      /url\s*[:=]\s*["']([^"']*m3u8[^"']*)["']/gi,
      /src\s*[:=]\s*["']([^"']*m3u8[^"']*)["']/gi,
      // Obfuscated patterns
      /\\x([0-9a-f]{2})/gi // hex encoded
    ];
    
    for (const pattern of jsPatterns) {
      let match;
      while ((match = pattern.exec(scriptContent)) !== null) {
        detections.push({ url: match[1] });
      }
    }
    
    return detections;
  }
  
  private static async detectWithBrowser(pageUrl: string): Promise<M3U8Detection[]> {
    console.log('Using browser automation for M3U8 detection...');
    
    let browser;
    let page: Page;
    
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080'
        ]
      });
      
      page = await browser.newPage();
      
      // Set up network request interception
      const interceptedUrls: M3U8Detection[] = [];
      
      await page.setRequestInterception(true);
      
      page.on('request', (request) => {
        const url = request.url();
        if (url.includes('.m3u8')) {
          console.log('Intercepted M3U8 request:', url);
          interceptedUrls.push({ url });
        }
        request.continue();
      });
      
      page.on('response', (response) => {
        const url = response.url();
        if (url.includes('.m3u8')) {
          console.log('Intercepted M3U8 response:', url);
          interceptedUrls.push({ url });
        }
      });
      
      // Set user agent and viewport
      await page.setUserAgent(this.getRandomUserAgent());
      await page.setViewport({ width: 1920, height: 1080 });
      
      console.log(`Navigating to: ${pageUrl}`);
      
      // Navigate and wait for network activity
      await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for JavaScript to execute and potentially load M3U8 URLs
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Try to trigger video loading by looking for play buttons or video elements
      try {
        // Look for common video trigger elements
        const videoTriggers = [
          'button[class*="play"]',
          '.play-button',
          '.video-play',
          'video',
          '[data-video]',
          '.player'
        ];
        
        for (const selector of videoTriggers) {
          const element = await page.$(selector);
          if (element) {
            console.log(`Found video trigger: ${selector}`);
            await element.click();
            await new Promise(resolve => setTimeout(resolve, 3000));
            break;
          }
        }
      } catch (e) {
        console.log('No video triggers found or error clicking them');
      }
      
      // Extract M3U8 URLs from page content as well
      const pageContent = await page.content();
      const staticDetections = await this.extractM3U8FromContent(pageContent, pageUrl);
      
      // Combine all detections
      const allDetections = [...interceptedUrls, ...staticDetections];
      
      // Remove duplicates
      const uniqueDetections = allDetections.filter((detection, index, self) => 
        index === self.findIndex(d => d.url === detection.url)
      ).filter(detection => this.isValidM3U8Url(detection.url));
      
      console.log(`Found ${uniqueDetections.length} M3U8 URLs`);
      return uniqueDetections;
      
    } catch (error) {
      console.error('Browser automation error:', error);
      return [];
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
  
  private static async extractM3U8FromContent(content: string, baseUrl: string): Promise<M3U8Detection[]> {
    const detections: M3U8Detection[] = [];
    
    const regex = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/gi;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      detections.push({ url: match[1] });
    }
    
    return detections;
  }
  
  private static isValidM3U8Url(url: string): boolean {
    try {
      new URL(url);
      return url.includes('.m3u8') && (url.startsWith('http://') || url.startsWith('https://'));
    } catch {
      return false;
    }
  }

  static async parsePlaylist(m3u8Url: string): Promise<M3U8Playlist> {
    try {
      const response = await axios.get(m3u8Url, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Referer': m3u8Url
        },
        timeout: 15000
      });
      
      const content = response.data;
      const lines = content.split('\n').map((line: string) => line.trim()).filter((line: string) => line);
      
      const segments: string[] = [];
      let totalDuration = 0;
      let isLive = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for live stream indicators
        if (line.includes('#EXT-X-PLAYLIST-TYPE:VOD')) {
          isLive = false;
        } else if (line.includes('#EXT-X-PLAYLIST-TYPE:LIVE') || line.includes('#EXT-X-TARGETDURATION')) {
          isLive = true;
        }
        
        // Parse segment duration
        if (line.startsWith('#EXTINF:')) {
          const duration = parseFloat(line.split(':')[1].split(',')[0]);
          totalDuration += duration;
        }
        
        // Parse segment URLs
        if (!line.startsWith('#') && line.length > 0) {
          let segmentUrl = line;
          
          // Convert relative URLs to absolute
          if (!segmentUrl.startsWith('http')) {
            const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
            segmentUrl = baseUrl + segmentUrl;
          }
          
          segments.push(segmentUrl);
        }
      }
      
      return {
        url: m3u8Url,
        segments,
        totalDuration,
        isLive
      };
    } catch (error) {
      console.error('Error parsing M3U8 playlist:', error);
      throw new Error(`Failed to parse M3U8 playlist: ${error}`);
    }
  }
  
  // Convenience method to maintain backward compatibility
  static async detectM3U8FromPageLegacy(pageUrl: string): Promise<string[]> {
    const detections = await this.detectM3U8FromPage(pageUrl);
    return detections.map(d => d.url);
  }
}
