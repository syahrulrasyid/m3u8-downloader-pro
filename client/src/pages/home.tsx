import { useState } from "react";
import { Download, FileVideo, Settings, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DownloadTable } from "@/components/download-table";
import { Sidebar } from "@/components/sidebar";
import { useTheme } from "@/components/theme-provider";
import { useQuery } from "@tanstack/react-query";
import type { Download as DownloadType } from "@shared/schema";

export default function Home() {
  const { theme, toggleTheme } = useTheme();

  const { data: downloads = [] } = useQuery<DownloadType[]>({
    queryKey: ["/api/downloads"],
  });

  const { data: stats } = useQuery<{
    totalDownloads: number;
    activeDownloads: number;
    completedDownloads: number;
    failedDownloads: number;
    totalSpeed: number;
  }>({
    queryKey: ["/api/stats"],
    refetchInterval: 2000, // Update every 2 seconds
  });

  const handleStartAll = () => {
    const queuedDownloads = downloads.filter((d) => d.status === "queued");
    queuedDownloads.forEach((download) => {
      fetch(`/api/downloads/${download.id}/start`, { method: "POST" });
    });
  };

  const handlePauseAll = () => {
    const activeDownloads = downloads.filter((d) => d.status === "downloading");
    activeDownloads.forEach((download) => {
      fetch(`/api/downloads/${download.id}/pause`, { method: "POST" });
    });
  };

  const handleStopAll = () => {
    const activeDownloads = downloads.filter((d) => 
      d.status === "downloading" || d.status === "queued"
    );
    activeDownloads.forEach((download) => {
      fetch(`/api/downloads/${download.id}/cancel`, { method: "POST" });
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Download className="text-primary text-2xl h-8 w-8" />
          <h1 className="text-2xl font-bold text-foreground">M3U8 Downloader Pro</h1>
        </div>
        <div className="flex items-center space-x-4">
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
          <Button variant="outline" data-testid="button-settings">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-80px)]">
        <Sidebar />
        
        {/* Main Content */}
        <div className="flex-1 flex flex-col bg-background">
          {/* Toolbar */}
          <div className="bg-card border-b border-border px-6 py-4 flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <Button 
                onClick={handleStartAll}
                className="bg-secondary hover:bg-secondary/90"
                data-testid="button-start-all"
              >
                <FileVideo className="h-4 w-4 mr-2" />
                Start All
              </Button>
              <Button 
                onClick={handlePauseAll}
                variant="outline"
                className="border-accent text-accent hover:bg-accent hover:text-accent-foreground"
                data-testid="button-pause-all"
              >
                Pause All
              </Button>
              <Button 
                onClick={handleStopAll}
                variant="destructive"
                data-testid="button-stop-all"
              >
                Stop All
              </Button>
            </div>
          </div>

          <DownloadTable downloads={downloads} />

          {/* Status Bar */}
          <div className="bg-card border-t border-border px-6 py-3 flex justify-between items-center text-sm">
            <div className="flex items-center space-x-6">
              <span className="text-muted-foreground">
                Total Downloads: <span className="font-medium text-foreground" data-testid="text-total-downloads">{stats?.totalDownloads || 0}</span>
              </span>
              <span className="text-muted-foreground">
                Active: <span className="font-medium text-primary" data-testid="text-active-downloads">{stats?.activeDownloads || 0}</span>
              </span>
              <span className="text-muted-foreground">
                Completed: <span className="font-medium text-success" data-testid="text-completed-downloads">{stats?.completedDownloads || 0}</span>
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-muted-foreground">
                Total Speed: <span className="font-medium text-foreground" data-testid="text-total-speed">
                  {stats?.totalSpeed ? `${(stats.totalSpeed / 1024 / 1024).toFixed(1)} MB/s` : "0 MB/s"}
                </span>
              </span>
              <span className="text-muted-foreground">
                Free Space: <span className="font-medium text-foreground" data-testid="text-free-space">250 GB</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
