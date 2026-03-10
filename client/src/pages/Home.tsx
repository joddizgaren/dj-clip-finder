import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatDuration, formatTime, cn } from "@/lib/utils";
import type { Upload, Clip } from "@shared/schema";
import {
  Upload as UploadIcon,
  Scissors,
  Music2,
  Zap,
  ArrowRight,
  Clock,
  Download,
  Trash2,
  Play,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Wifi,
  HardDrive,
  Info,
} from "lucide-react";

const CLIP_DURATIONS = [15, 20, 30, 45] as const;
type ClipDuration = typeof CLIP_DURATIONS[number];

function HighlightBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string }> = {
    drop:       { label: "Drop",       className: "bg-primary/10 text-primary" },
    transition: { label: "Transition", className: "bg-chart-2/10 text-chart-2" },
    build:      { label: "Build",      className: "bg-chart-4/10 text-chart-4" },
  };
  const c = config[type] ?? { label: type, className: "bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", c.className)}>
      {c.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
    processing:  { icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Analyzing",  className: "text-chart-4 border-chart-4/30 bg-chart-4/10" },
    analyzed:    { icon: <CheckCircle2 className="w-3 h-3" />,         label: "Ready",      className: "text-chart-3 border-chart-3/30 bg-chart-3/10" },
    generating:  { icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Generating", className: "text-primary border-primary/30 bg-primary/10" },
    error:       { icon: <AlertCircle className="w-3 h-3" />,          label: "Error",      className: "text-destructive border-destructive/30 bg-destructive/10" },
  };
  const s = map[status] ?? { icon: null, label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("gap-1 text-xs font-medium", s.className)}>
      {s.icon}{s.label}
    </Badge>
  );
}

function ClipCard({ clip, onDelete }: { clip: Clip; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className="hover-elevate"
      data-testid={`card-clip-${clip.id}`}
    >
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <HighlightBadge type={clip.highlightType} />
            <span className="text-sm font-medium text-foreground">
              {clip.duration}s clip
            </span>
            <span className="text-xs text-muted-foreground">
              {formatTime(clip.startTime)} – {formatTime(clip.endTime)}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div
              className="flex items-center gap-1 text-xs text-muted-foreground"
              data-testid={`text-energy-${clip.id}`}
            >
              <Zap className="w-3 h-3 text-chart-4" />
              {clip.energyLevel}%
            </div>
          </div>
        </div>

        {/* Energy bar */}
        <Progress value={clip.energyLevel} className="h-1" />

        {/* Preview toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="justify-between px-0 text-muted-foreground"
          onClick={() => setExpanded(e => !e)}
          data-testid={`button-preview-${clip.id}`}
        >
          <span className="flex items-center gap-1">
            <Play className="w-3 h-3" />
            Preview clip
          </span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </Button>

        {expanded && (
          <video
            controls
            className="w-full rounded-md bg-black"
            src={`/api/clips/${clip.id}/stream`}
            data-testid={`video-preview-${clip.id}`}
          />
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-2"
            asChild
            data-testid={`button-download-${clip.id}`}
          >
            <a href={`/api/clips/${clip.id}/download`} download>
              <Download className="w-3 h-3" />
              Download
            </a>
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="shrink-0 text-destructive"
            onClick={() => onDelete(clip.id)}
            data-testid={`button-delete-clip-${clip.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function UploadCard({ upload, onDelete }: { upload: Upload; onDelete: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedDurations, setSelectedDurations] = useState<ClipDuration[]>([15]);
  const [maxClips, setMaxClips] = useState<string>("");
  const [showClips, setShowClips] = useState(false);
  const isGenerating = upload.status === "generating";

  const { data: clips = [] } = useQuery<Clip[]>({
    queryKey: ["/api/uploads", upload.id, "clips"],
    queryFn: () => fetch(`/api/uploads/${upload.id}/clips`).then(r => r.json()),
    // Poll during generation so clips appear as they're encoded
    refetchInterval: isGenerating ? 4000 : false,
    enabled: upload.status === "analyzed" || isGenerating || showClips,
  });

  // Auto-expand clips section when clips start appearing
  const prevClipCount = useRef(0);
  useEffect(() => {
    if (clips.length > 0 && prevClipCount.current === 0) {
      setShowClips(true);
    }
    prevClipCount.current = clips.length;
  }, [clips.length]);

  // Poll for status while processing or generating
  useQuery<Upload>({
    queryKey: ["/api/uploads", upload.id],
    queryFn: () => fetch(`/api/uploads/${upload.id}`).then(r => r.json()),
    refetchInterval: (query) => {
      const data = query.state.data as Upload | undefined;
      if (data?.status === "processing" || data?.status === "generating") return 3000;
      return false;
    },
    enabled: upload.status === "processing" || isGenerating,
  });

  const maxClipsNumber = maxClips.trim() === "" ? 0 : parseInt(maxClips, 10);

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/uploads/${upload.id}/generate`, {
        durations: selectedDurations,
        maxClips: maxClipsNumber > 0 ? maxClipsNumber : 0,
      }),
    onSuccess: () => {
      const limitText = maxClipsNumber > 0 ? `top ${maxClipsNumber}` : "all";
      toast({
        title: "Generating clips…",
        description: `Encoding ${limitText} highlight moments. Clips will appear as they're ready.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteClipMutation = useMutation({
    mutationFn: (clipId: string) => apiRequest("DELETE", `/api/clips/${clipId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploads", upload.id, "clips"] });
    },
  });

  const toggleDuration = (d: ClipDuration) => {
    setSelectedDurations(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    );
  };

  return (
    <Card data-testid={`card-upload-${upload.id}`}>
      <CardContent className="p-5 flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <p
              className="font-semibold text-foreground truncate text-sm"
              data-testid={`text-filename-${upload.id}`}
            >
              {upload.filename}
            </p>
            {upload.duration > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDuration(upload.duration)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={upload.status} />
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => onDelete(upload.id)}
              data-testid={`button-delete-upload-${upload.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {upload.status === "error" && upload.error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-md p-3">
            {upload.error}
          </div>
        )}

        {/* Duration picker + generate */}
        {(upload.status === "analyzed") && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Clip durations</p>
              <div className="flex gap-2 flex-wrap">
                {CLIP_DURATIONS.map(d => (
                  <Button
                    key={d}
                    variant={selectedDurations.includes(d) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleDuration(d)}
                    data-testid={`button-duration-${d}-${upload.id}`}
                  >
                    {d}s
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Maximum clips <span className="font-normal text-muted-foreground/70">(leave blank for all)</span>
              </p>
              <Input
                type="number"
                min={1}
                placeholder="e.g. 10"
                value={maxClips}
                onChange={e => setMaxClips(e.target.value)}
                className="w-32 h-8 text-sm"
                data-testid={`input-max-clips-${upload.id}`}
              />
            </div>
            <Button
              className="gap-2"
              disabled={selectedDurations.length === 0 || generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
              data-testid={`button-generate-${upload.id}`}
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Scissors className="w-4 h-4" />
              )}
              {maxClipsNumber > 0
                ? `Generate top ${maxClipsNumber} × ${selectedDurations.join(", ")}s`
                : `Generate all × ${selectedDurations.join(", ")}s`}
            </Button>
          </div>
        )}

        {/* Generating progress */}
        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
            <span>
              {clips.length > 0
                ? `${clips.length} clip${clips.length > 1 ? "s" : ""} ready so far — still encoding…`
                : "Analyzing audio and encoding clips…"}
            </span>
          </div>
        )}

        {/* Clips section */}
        {clips.length > 0 && (
          <div className="flex flex-col gap-3">
            <Button
              variant="ghost"
              className="justify-between px-0 text-sm font-medium"
              onClick={() => setShowClips(s => !s)}
              data-testid={`button-toggle-clips-${upload.id}`}
            >
              <span className="flex items-center gap-2">
                <Scissors className="w-4 h-4 text-primary" />
                {clips.length} clip{clips.length > 1 ? "s" : ""} {isGenerating ? "so far" : "generated"}
              </span>
              {showClips ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
            {showClips && (
              <div className="grid grid-cols-1 gap-3">
                {clips.map(clip => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    onDelete={(id) => deleteClipMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [localPath, setLocalPath] = useState("");

  const { data: uploads = [], isLoading } = useQuery<Upload[]>({
    queryKey: ["/api/uploads"],
    refetchInterval: (query) => {
      const items = query.state.data as Upload[] | undefined;
      if (items?.some(u => u.status === "processing" || u.status === "generating")) return 3000;
      return false;
    },
  });

  const deleteUploadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/uploads/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/uploads"] }),
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const localPathMutation = useMutation({
    mutationFn: (filePath: string) =>
      apiRequest("POST", "/api/uploads/local", { filePath }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
      toast({ title: "File registered!", description: "Analyzing audio for highlight moments..." });
      setLocalPath("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to register file", description: err.message, variant: "destructive" });
    },
  });

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!file.type.startsWith("video/") && !file.name.match(/\.(mp4|mov|avi|webm|mkv)$/i)) {
      toast({ title: "Invalid file", description: "Please upload a video file (MP4, MOV, AVI, WebM, MKV).", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    formData.append("video", file);

    setUploading(true);
    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      setUploadProgress(0);
      if (xhr.status === 201) {
        queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
        toast({ title: "Video uploaded!", description: "Analyzing audio for highlight moments..." });
      } else {
        toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
    };
    xhr.open("POST", "/api/uploads");
    xhr.send(formData);
  }, [queryClient, toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragging(false), []);

  const hasProcessing = uploads.some(u => u.status === "processing" || u.status === "generating");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-8">
        {/* Hero header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center shrink-0">
              <Music2 className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">DJ Clip Studio</h1>
              <p className="text-sm text-muted-foreground">Auto-detect your best moments and cut social-ready clips</p>
            </div>
          </div>
        </div>

        {/* How it works */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4 flex-wrap">
              {[
                { icon: <UploadIcon className="w-4 h-4" />, label: "Add your set" },
                { icon: <ArrowRight className="w-3 h-3 text-muted-foreground" />, label: null },
                { icon: <Music2 className="w-4 h-4" />, label: "AI finds drops & transitions" },
                { icon: <ArrowRight className="w-3 h-3 text-muted-foreground" />, label: null },
                { icon: <Scissors className="w-4 h-4" />, label: "Get ready-to-post clips" },
              ].map((step, i) =>
                step.label ? (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="text-primary">{step.icon}</span>
                    {step.label}
                  </div>
                ) : (
                  <span key={i}>{step.icon}</span>
                )
              )}
            </div>
          </CardContent>
        </Card>

        {/* Two input options */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

          {/* Option A — Local file path */}
          <Card data-testid="card-option-local">
            <CardContent className="p-5 flex flex-col gap-3 h-full">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-accent flex items-center justify-center shrink-0">
                  <HardDrive className="w-4 h-4 text-accent-foreground" />
                </div>
                <span className="font-semibold text-sm text-foreground">Local file path</span>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Paste the full path to your video file. The app reads it directly from your disk — no transfer, no waiting.
              </p>

              {/* Disclaimer */}
              <div className="flex gap-2 bg-accent/50 rounded-md p-2.5">
                <Info className="w-3.5 h-3.5 text-accent-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-accent-foreground leading-relaxed">
                  <span className="font-medium">Requires local setup.</span> Only works when this app is running on the same computer as your video files (e.g. your own machine, not a remote server).
                </div>
              </div>

              <div className="flex flex-col gap-2 mt-auto pt-1">
                <Input
                  placeholder="/Users/you/sets/ibiza-set.mp4"
                  value={localPath}
                  onChange={e => setLocalPath(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && localPath.trim() && localPathMutation.mutate(localPath)}
                  data-testid="input-local-path"
                />
                <Button
                  className="w-full gap-2"
                  disabled={!localPath.trim() || localPathMutation.isPending}
                  onClick={() => localPathMutation.mutate(localPath)}
                  data-testid="button-add-local-path"
                >
                  {localPathMutation.isPending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <FolderOpen className="w-4 h-4" />}
                  Add file
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Option B — Upload */}
          <Card data-testid="card-option-upload">
            <CardContent className="p-5 flex flex-col gap-3 h-full">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                  <Wifi className="w-4 h-4 text-primary" />
                </div>
                <span className="font-semibold text-sm text-foreground">Upload file</span>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Drag and drop your video or browse to select it. The file is transferred to the server before processing starts.
              </p>

              {/* Disclaimer */}
              <div className="flex gap-2 bg-muted/60 rounded-md p-2.5">
                <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium">Works from anywhere.</span> Use from any browser on any device. Large files (5–10 GB) may take several minutes to transfer depending on your connection speed.
                </div>
              </div>

              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => !uploading && fileInputRef.current?.click()}
                className={cn(
                  "mt-auto border-2 border-dashed rounded-md p-5 text-center cursor-pointer transition-colors flex flex-col items-center gap-3",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/30 hover:bg-muted/50 hover:border-muted-foreground/40"
                )}
                data-testid="drop-zone-upload"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,.mp4,.mov,.avi,.webm,.mkv"
                  className="hidden"
                  onChange={e => handleFiles(e.target.files)}
                  data-testid="input-video-file"
                />
                {uploading ? (
                  <>
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                    <div className="flex flex-col gap-1.5 w-full">
                      <p className="text-xs font-medium text-foreground">Uploading... {uploadProgress}%</p>
                      <Progress value={uploadProgress} className="h-1.5" />
                    </div>
                  </>
                ) : (
                  <>
                    <UploadIcon className={cn("w-6 h-6", isDragging ? "text-primary" : "text-muted-foreground")} />
                    <div>
                      <p className="text-xs font-medium text-foreground">Drop here or browse</p>
                      <p className="text-xs text-muted-foreground mt-0.5">MP4, MOV, AVI, WebM, MKV — up to 20 GB</p>
                    </div>
                    <Button size="sm" variant="outline" data-testid="button-browse-files">
                      Browse files
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Uploads list */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : uploads.length > 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground text-sm">Your Sets</h2>
              {hasProcessing && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Analyzing audio...
                </span>
              )}
            </div>
            {uploads.map(upload => (
              <UploadCard
                key={upload.id}
                upload={upload}
                onDelete={(id) => deleteUploadMutation.mutate(id)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
