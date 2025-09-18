import { FileVideo, Play, Pause, Square, Folder, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useWebSocket } from "@/hooks/use-websocket";
import type { Download } from "@shared/schema";

interface DownloadTableProps {
  downloads: Download[];
}

export function DownloadTable({ downloads }: DownloadTableProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // WebSocket for real-time updates
  useWebSocket("/ws", (message) => {
    if (message.type === "download_progress" || message.type === "download_status") {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    }
  });

  const startDownloadMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/downloads/${id}/start`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
    },
    onError: (error) => {
      toast({
        title: "Failed to start download",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const pauseDownloadMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/downloads/${id}/pause`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
    },
  });

  const cancelDownloadMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/downloads/${id}/cancel`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
    },
  });

  const deleteDownloadMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/downloads/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
    },
  });

  const retryMergeMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `/api/downloads/${id}/retry-merge`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      toast({
        title: "Merge retry started",
        description: "The merge process has been restarted for this download.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to retry merge",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const getStatusIndicator = (status: string) => {
    const baseClasses = "status-indicator";
    switch (status) {
      case "downloading":
        return `${baseClasses} status-downloading`;
      case "completed":
        return `${baseClasses} status-completed`;
      case "paused":
        return `${baseClasses} status-paused`;
      case "error":
        return `${baseClasses} status-error`;
      default:
        return `${baseClasses} status-queued`;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "downloading":
        return "text-primary";
      case "completed":
        return "text-success";
      case "paused":
        return "text-accent";
      case "error":
        return "text-destructive";
      default:
        return "text-muted-foreground";
    }
  };

  const getProgressColor = (status: string) => {
    switch (status) {
      case "downloading":
        return "bg-primary";
      case "completed":
        return "bg-success";
      case "paused":
        return "bg-accent";
      case "error":
        return "bg-destructive";
      default:
        return "bg-muted-foreground";
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatTime = (seconds: number) => {
    if (seconds === 0) return "-";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  if (downloads.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <FileVideo className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Downloads Yet</h3>
          <p className="text-muted-foreground">Add a website URL in the sidebar to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full">
        <thead className="bg-muted/50 border-b border-border sticky top-0">
          <tr>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground w-8">
              <Checkbox />
            </th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground">File Name</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground w-32">Status</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground w-48">Progress</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground w-24">Size</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground w-32">Speed</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground w-32">ETA</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground w-32">Actions</th>
          </tr>
        </thead>
        <tbody>
          {downloads.map((download) => (
            <tr
              key={download.id}
              className="download-row border-b border-border hover:bg-muted/30 transition-colors"
              data-testid={`row-download-${download.id}`}
            >
              <td className="p-3">
                <Checkbox />
              </td>
              <td className="p-3">
                <div className="flex items-center space-x-3">
                  <FileVideo className={`h-5 w-5 ${getStatusColor(download.status)}`} />
                  <div>
                    <div className="font-medium text-foreground" data-testid={`text-filename-${download.id}`}>
                      {download.filename}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-xs" title={download.m3u8Url || ""}>
                      {download.m3u8Url}
                    </div>
                  </div>
                </div>
              </td>
              <td className="p-3">
                <div className="flex items-center">
                  <span className={getStatusIndicator(download.status)}></span>
                  <span className={`text-sm capitalize ${getStatusColor(download.status)}`} data-testid={`text-status-${download.id}`}>
                    {download.status}
                  </span>
                </div>
              </td>
              <td className="p-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span data-testid={`text-progress-${download.id}`}>{Math.round(download.progress)}%</span>
                    <span data-testid={`text-segments-${download.id}`}>
                      {download.downloadedSegments}/{download.totalSegments} segments
                    </span>
                  </div>
                  <Progress
                    value={download.progress}
                    className="h-2"
                    data-testid={`progress-${download.id}`}
                  />
                </div>
              </td>
              <td className="p-3 text-sm text-foreground" data-testid={`text-size-${download.id}`}>
                {formatBytes(download.fileSize || 0)}
              </td>
              <td className="p-3 text-sm text-foreground" data-testid={`text-speed-${download.id}`}>
                {download.speed && download.status === "downloading" 
                  ? `${formatBytes(download.speed)}/s` 
                  : "-"}
              </td>
              <td className="p-3 text-sm text-muted-foreground" data-testid={`text-eta-${download.id}`}>
                {download.eta && download.status === "downloading" 
                  ? formatTime(download.eta) 
                  : "-"}
              </td>
              <td className="p-3">
                <div className="flex space-x-1">
                  {download.status === "queued" || download.status === "paused" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startDownloadMutation.mutate(download.id)}
                      disabled={startDownloadMutation.isPending}
                      data-testid={`button-start-${download.id}`}
                    >
                      <Play className="h-4 w-4 text-secondary" />
                    </Button>
                  ) : download.status === "downloading" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => pauseDownloadMutation.mutate(download.id)}
                      disabled={pauseDownloadMutation.isPending}
                      data-testid={`button-pause-${download.id}`}
                    >
                      <Pause className="h-4 w-4 text-accent" />
                    </Button>
                  ) : download.status === "error" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startDownloadMutation.mutate(download.id)}
                      disabled={startDownloadMutation.isPending}
                      data-testid={`button-retry-${download.id}`}
                    >
                      <RotateCcw className="h-4 w-4 text-primary" />
                    </Button>
                  ) : download.status === "completed" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => retryMergeMutation.mutate(download.id)}
                      disabled={retryMergeMutation.isPending}
                      data-testid={`button-retry-merge-${download.id}`}
                      title="Retry merging segments into final video file"
                    >
                      <RotateCcw className="h-4 w-4 text-success" />
                    </Button>
                  ) : null}
                  
                  {download.status !== "completed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelDownloadMutation.mutate(download.id)}
                      disabled={cancelDownloadMutation.isPending}
                      data-testid={`button-cancel-${download.id}`}
                    >
                      <Square className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`button-folder-${download.id}`}
                  >
                    <Folder className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteDownloadMutation.mutate(download.id)}
                    disabled={deleteDownloadMutation.isPending}
                    data-testid={`button-delete-${download.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
