import { useState } from "react";
import { Search, Folder, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function Sidebar() {
  const [url, setUrl] = useState("");
  const [detectedUrls, setDetectedUrls] = useState<string[]>([]);
  const [selectedM3u8, setSelectedM3u8] = useState("");
  const [filename, setFilename] = useState("");
  const [threads, setThreads] = useState("4");
  const [outputPath, setOutputPath] = useState("./downloads");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats } = useQuery<{
    totalDownloads: number;
    activeDownloads: number;
    completedDownloads: number;
    failedDownloads: number;
    totalSpeed: number;
  }>({
    queryKey: ["/api/stats"],
    refetchInterval: 2000,
  });

  const detectM3u8Mutation = useMutation({
    mutationFn: async (pageUrl: string) => {
      const response = await apiRequest("POST", "/api/detect-m3u8", { url: pageUrl });
      return response.json();
    },
    onSuccess: (data) => {
      setDetectedUrls(data.m3u8Urls);
      if (data.m3u8Urls.length > 0) {
        setSelectedM3u8(data.m3u8Urls[0]);
        // Generate filename from URL
        const urlParts = new URL(url).pathname.split('/');
        const lastPart = urlParts[urlParts.length - 1] || 'video';
        setFilename(lastPart.replace(/\.[^/.]+$/, "") + ".mkv");
      } else {
        toast({
          title: "No M3U8 URLs found",
          description: "Could not detect any M3U8 playlists on the provided URL.",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Detection failed",
        description: error instanceof Error ? error.message : "Failed to detect M3U8 URLs",
        variant: "destructive",
      });
    },
  });

  const addDownloadMutation = useMutation({
    mutationFn: async (downloadData: any) => {
      const response = await apiRequest("POST", "/api/downloads", downloadData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/downloads"] });
      toast({
        title: "Download added",
        description: "Your download has been added to the queue.",
      });
      // Reset form
      setUrl("");
      setDetectedUrls([]);
      setSelectedM3u8("");
      setFilename("");
    },
    onError: (error) => {
      toast({
        title: "Failed to add download",
        description: error instanceof Error ? error.message : "Could not add download",
        variant: "destructive",
      });
    },
  });

  const handleDetectM3u8 = () => {
    if (!url) {
      toast({
        title: "URL required",
        description: "Please enter a website URL to detect M3U8 playlists.",
        variant: "destructive",
      });
      return;
    }
    detectM3u8Mutation.mutate(url);
  };

  const handleAddDownload = () => {
    if (!selectedM3u8 || !filename) {
      toast({
        title: "Missing information",
        description: "Please select an M3U8 URL and enter a filename.",
        variant: "destructive",
      });
      return;
    }

    addDownloadMutation.mutate({
      url,
      m3u8Url: selectedM3u8,
      filename,
      threads: parseInt(threads),
      outputPath,
      status: "queued",
    });
  };

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col">
      {/* URL Input Section */}
      <div className="p-6 border-b border-border">
        <h2 className="text-lg font-semibold mb-4 text-foreground">Add New Download</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="url-input" className="block text-sm font-medium text-muted-foreground mb-2">
              Website URL
            </Label>
            <Input
              id="url-input"
              type="url"
              placeholder="https://example.com/video-page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="input-website-url"
            />
          </div>
          
          <Button 
            onClick={handleDetectM3u8}
            disabled={detectM3u8Mutation.isPending}
            className="w-full"
            data-testid="button-detect-m3u8"
          >
            <Search className="h-4 w-4 mr-2" />
            {detectM3u8Mutation.isPending ? "Detecting..." : "Detect M3U8"}
          </Button>

          {detectedUrls.length > 0 && (
            <>
              <div>
                <Label className="block text-sm font-medium text-muted-foreground mb-2">
                  Detected M3U8 URLs
                </Label>
                <Select value={selectedM3u8} onValueChange={setSelectedM3u8}>
                  <SelectTrigger data-testid="select-m3u8-url" className="h-auto min-h-[2.5rem] select-no-truncate">
                    <SelectValue placeholder="Select M3U8 URL" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[600px] w-max">
                    {detectedUrls.map((m3u8Url, index) => (
                      <SelectItem key={index} value={m3u8Url} className="whitespace-normal break-all">
                        {m3u8Url}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="filename-input" className="block text-sm font-medium text-muted-foreground mb-2">
                  Filename
                </Label>
                <Input
                  id="filename-input"
                  type="text"
                  placeholder="video.mkv"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  data-testid="input-filename"
                />
              </div>

              <Button
                onClick={handleAddDownload}
                disabled={addDownloadMutation.isPending}
                className="w-full bg-secondary hover:bg-secondary/90"
                data-testid="button-add-download"
              >
                {addDownloadMutation.isPending ? "Adding..." : "Add Download"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Download Settings */}
      <div className="p-6 border-b border-border">
        <h3 className="text-md font-semibold mb-3 text-foreground">Download Settings</h3>
        <div className="space-y-3">
          <div>
            <Label className="block text-sm font-medium text-muted-foreground mb-1">Threads</Label>
            <Select value={threads} onValueChange={setThreads}>
              <SelectTrigger data-testid="select-threads">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">4 threads</SelectItem>
                <SelectItem value="8">8 threads</SelectItem>
                <SelectItem value="16">16 threads</SelectItem>
                <SelectItem value="32">32 threads</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="output-path" className="block text-sm font-medium text-muted-foreground mb-1">
              Output Directory
            </Label>
            <div className="flex">
              <Input
                id="output-path"
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                className="flex-1 rounded-r-none"
                data-testid="input-output-path"
              />
              <Button 
                variant="outline" 
                className="rounded-l-none border-l-0"
                data-testid="button-browse-folder"
              >
                <Folder className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Statistics */}
      <div className="p-6 flex-1">
        <h3 className="text-md font-semibold mb-3 text-foreground">Statistics</h3>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Active Downloads:</span>
            <span className="font-medium text-primary" data-testid="stat-active-downloads">
              {stats?.activeDownloads || 0}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Speed:</span>
            <span className="font-medium text-foreground" data-testid="stat-total-speed">
              {stats?.totalSpeed ? `${(stats.totalSpeed / 1024 / 1024).toFixed(1)} MB/s` : "0 MB/s"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Completed:</span>
            <span className="font-medium text-success" data-testid="stat-completed-downloads">
              {stats?.completedDownloads || 0}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Failed:</span>
            <span className="font-medium text-destructive" data-testid="stat-failed-downloads">
              {stats?.failedDownloads || 0}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
