import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { execSync } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export interface MergeOptions {
  outputPath: string;
  filename: string;
  segmentPaths: string[];
  onProgress?: (progress: number) => void;
}

export interface MergeResult {
  success: boolean;
  outputFile?: string;
  error?: string;
  duration?: number;
}

export class VideoMerger {
  private static ffmpegPath: string | null = null;

  static async initialize(): Promise<void> {
    try {
      const possiblePaths = [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        'ffmpeg' // fallback to PATH
      ];

      let ffmpegBinary: string | null = null;

      for (const ffPath of possiblePaths) {
        try {
          execSync(`${ffPath} -version`, { stdio: 'pipe' });
          ffmpegBinary = ffPath;
          break;
        } catch {
          console.warn(`FFmpeg not found at ${ffPath}`);
        }
      }

      // Fallback to @ffmpeg-installer/ffmpeg
      if (!ffmpegBinary) {
        ffmpegBinary = ffmpegInstaller.path;
        console.log(`Using bundled FFmpeg from @ffmpeg-installer: ${ffmpegBinary}`);
      } else {
        console.log(`FFmpeg found at: ${ffmpegBinary}`);
      }

      this.ffmpegPath = ffmpegBinary;
      ffmpeg.setFfmpegPath(ffmpegBinary);
    } catch (error) {
      console.error('FFmpeg initialization failed:', error);
      throw new Error('FFmpeg not found. Please install FFmpeg or add @ffmpeg-installer/ffmpeg.');
    }
  }

  static async mergeSegmentsToMKV(options: MergeOptions): Promise<MergeResult> {
    const { outputPath, filename, segmentPaths, onProgress } = options;

    if (!this.ffmpegPath) {
      await this.initialize();
    }

    try {
      await fs.mkdir(outputPath, { recursive: true });

      const concatFilePath = path.join(outputPath, `${filename}_concat.txt`);
      // Remove .mkv extension if it already exists, then add .mkv
      const cleanFilename = filename.endsWith('.mkv') ? filename.slice(0, -4) : filename;
      const outputFilePath = path.join(outputPath, `${cleanFilename}.mkv`);

      const sortedSegments = segmentPaths.sort((a, b) => {
        const aMatch = a.match(/_segment_(\d+)\./);
        const bMatch = b.match(/_segment_(\d+)\./);
        const aIndex = aMatch ? parseInt(aMatch[1]) : 0;
        const bIndex = bMatch ? parseInt(bMatch[1]) : 0;
        return aIndex - bIndex;
      });

      const concatContent = sortedSegments
        .map(segmentPath => `file '${path.resolve(segmentPath)}'`)
        .join('\n');

      await fs.writeFile(concatFilePath, concatContent);

      console.log(`Merging ${sortedSegments.length} segments into ${outputFilePath}`);

      return new Promise((resolve) => {
        const command = ffmpeg()
          .input(concatFilePath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions([
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            '-fflags', '+genpts'
          ])
          .output(outputFilePath)
          .on('start', (commandLine) => {
            console.log('FFmpeg command:', commandLine);
          })
          .on('progress', (progress) => {
            if (onProgress && progress.percent) {
              onProgress(Math.round(progress.percent));
            }
            console.log(`Merge progress: ${Math.round(progress.percent || 0)}%`);
          })
          .on('end', async () => {
            console.log('Video merge completed successfully');
            try {
              await fs.unlink(concatFilePath);
              const duration = await this.getVideoDuration(outputFilePath);
              await this.cleanupSegmentFiles(sortedSegments);
              resolve({ success: true, outputFile: outputFilePath, duration });
            } catch (cleanupError) {
              console.error('Error during cleanup:', cleanupError);
              resolve({
                success: true,
                outputFile: outputFilePath,
                error: `Merge successful but cleanup failed: ${cleanupError}`
              });
            }
          })
          .on('error', async (error) => {
            console.error('FFmpeg error:', error);
            try { await fs.unlink(concatFilePath); } catch {}
            resolve({ success: false, error: error.message });
          });

        command.run();
      });
    } catch (error) {
      console.error('Error in mergeSegmentsToMKV:', error);
      return {
        success: false,
        error: `Failed to merge segments: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  private static async cleanupSegmentFiles(segmentPaths: string[]): Promise<void> {
    await Promise.allSettled(segmentPaths.map(async (segmentPath) => {
      try {
        await fs.unlink(segmentPath);
        console.log(`Cleaned up segment: ${segmentPath}`);
      } catch (error) {
        console.warn(`Failed to clean up segment ${segmentPath}:`, error);
      }
    }));
  }

  private static async getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          console.warn('Could not get video duration:', err);
          resolve(0);
          return;
        }
        resolve(metadata.format.duration || 0);
      });
    });
  }

  static async mergeSegmentsBinary(options: MergeOptions): Promise<MergeResult> {
    const { outputPath, filename, segmentPaths } = options;

    try {
      await fs.mkdir(outputPath, { recursive: true });
      // Remove .mkv extension if it already exists, then add .mkv
      const cleanFilename = filename.endsWith('.mkv') ? filename.slice(0, -4) : filename;
      const outputFilePath = path.join(outputPath, `${cleanFilename}.mkv`);
      console.log(`Binary concatenating ${segmentPaths.length} segments`);

      const sortedSegments = segmentPaths.sort((a, b) => {
        const aMatch = a.match(/_segment_(\d+)\./);
        const bMatch = b.match(/_segment_(\d+)\./);
        const aIndex = aMatch ? parseInt(aMatch[1]) : 0;
        const bIndex = bMatch ? parseInt(bMatch[1]) : 0;
        return aIndex - bIndex;
      });

      const writeStream = createWriteStream(outputFilePath);
      for (const segmentPath of sortedSegments) {
        const segmentData = await fs.readFile(segmentPath);
        writeStream.write(segmentData);
      }
      writeStream.end();

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      await this.cleanupSegmentFiles(sortedSegments);
      return { success: true, outputFile: outputFilePath };
    } catch (error) {
      return {
        success: false,
        error: `Binary merge failed: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  static async checkFFmpegAvailability(): Promise<boolean> {
    try {
      await this.initialize();
      return true;
    } catch {
      return false;
    }
  }

  static async getSupportedFormats(): Promise<{ input: string[]; output: string[] }> {
    if (!this.ffmpegPath) {
      await this.initialize();
    }
    return new Promise((resolve) => {
      ffmpeg.getAvailableFormats((err, formats) => {
        if (err) {
          resolve({ input: [], output: [] });
          return;
        }
        const input = Object.keys(formats).filter(fmt => formats[fmt].canDemux);
        const output = Object.keys(formats).filter(fmt => formats[fmt].canMux);
        resolve({ input, output });
      });
    });
  }
}
