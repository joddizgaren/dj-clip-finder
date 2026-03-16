import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { formatDuration, formatTime, cn } from "@/lib/utils";
import type { Upload, Clip, BrowseResponse } from "@shared/schema";
import {
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
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Folder,
  Film,
  ChevronRight,
  Home as HomeIcon,
  Mic,
  Cable,
  Cpu,
  MonitorSmartphone,
  Square,
} from "lucide-react";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const CLIP_DURATIONS = [15, 20, 30, 45] as const;
type ClipDuration = typeof CLIP_DURATIONS[number];

type Sensitivity    = "conservative" | "balanced" | "aggressive";
type RecordingType  = "cable" | "mic" | "auto";
type OutputFormat   = "original" | "9:16" | "3:4" | "4:5" | "1:1" | "16:9";
type CropMethod     = "blur" | "crop";
type BuildUp        = "none" | "short" | "medium" | "long" | "auto";

const FORMAT_RATIOS: Record<Exclude<OutputFormat, "original">, number> = {
  "9:16": 9 / 16,
  "3:4":  3 / 4,
  "4:5":  4 / 5,
  "1:1":  1,
  "16:9": 16 / 9,
};

function detectFormat(w: number, h: number): OutputFormat {
  if (!w || !h) return "original";
  const ratio = w / h;
  let best: OutputFormat = "original";
  let bestDiff = Infinity;
  for (const [fmt, r] of Object.entries(FORMAT_RATIOS)) {
    const diff = Math.abs(ratio - r);
    if (diff < bestDiff) { bestDiff = diff; best = fmt as OutputFormat; }
  }
  return bestDiff < 0.05 ? best : "original";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

// ─────────────────────────────────────────────
// FileBrowserModal
// ─────────────────────────────────────────────

function FileBrowserModal({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (filePath: string) => void;
}) {
  const [browsePath, setBrowsePath] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { data: browseData, isLoading: isBrowsing, error: browseError } = useQuery<BrowseResponse>({
    queryKey: ["/api/browse", browsePath],
    queryFn: () =>
      fetch(`/api/browse${browsePath ? `?path=${encodeURIComponent(browsePath)}` : ""}`)
        .then(r => r.json()),
    enabled: open,
  });

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setBrowsePath("");
      setSelectedFile(null);
    }
  }, [open]);

  const handleDirClick = (dir: string) => {
    if (!browseData) return;
    const sep = browseData.path.includes("\\") ? "\\" : "/";
    setBrowsePath(browseData.path + sep + dir);
    setSelectedFile(null);
  };

  const handleParentClick = () => {
    if (browseData?.parent) {
      setBrowsePath(browseData.parent);
      setSelectedFile(null);
    }
  };

  const handleFileClick = (fullPath: string) => {
    setSelectedFile(prev => prev === fullPath ? null : fullPath);
  };

  // Build breadcrumb segments — guard against undefined while loading
  const pathSep = browseData?.path?.includes("\\") ? "\\" : "/";
  const isWin   = browseData?.path?.includes("\\") ?? false;
  const segments = browseData?.path
    ? browseData.path
        .split(pathSep)
        .filter(Boolean)
        .map((seg, i, arr) => ({
          label: seg,
          path: (isWin ? "" : "/") + arr.slice(0, i + 1).join(pathSep),
        }))
    : [];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-5 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary" />
            Browse for video file
          </DialogTitle>
          <DialogDescription className="sr-only">
            Navigate your file system to find and select a video file.
          </DialogDescription>

          {/* Breadcrumb */}
          {browseData && (
            <div className="flex items-center gap-1 flex-wrap mt-2">
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => { setBrowsePath(""); setSelectedFile(null); }}>
                <HomeIcon className="w-3 h-3" />
              </Button>
              {segments.map((seg, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    onClick={() => { setBrowsePath(seg.path); setSelectedFile(null); }}
                  >
                    {seg.label}
                  </Button>
                </span>
              ))}
            </div>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 px-5 min-h-0" style={{ maxHeight: "50vh" }}>
          {isBrowsing && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {browseError && (
            <div className="text-destructive text-sm py-4 text-center">
              Could not read directory. Try navigating elsewhere.
            </div>
          )}

          {browseData && !isBrowsing && (
            <div className="flex flex-col gap-0.5 py-2">
              {/* Parent directory */}
              {browseData.parent && (
                <button
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors text-left w-full"
                  onClick={handleParentClick}
                  data-testid="button-browse-parent"
                >
                  <Folder className="w-4 h-4 shrink-0 text-chart-4" />
                  <span className="italic">..</span>
                </button>
              )}

              {/* Directories */}
              {browseData.dirs.map(dir => (
                <button
                  key={dir}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left w-full"
                  onClick={() => handleDirClick(dir)}
                  data-testid={`button-browse-dir-${dir}`}
                >
                  <Folder className="w-4 h-4 shrink-0 text-chart-4" />
                  <span className="truncate">{dir}</span>
                </button>
              ))}

              {/* Video files */}
              {browseData.files.map(file => (
                <button
                  key={file.fullPath}
                  className={cn(
                    "flex items-center gap-2.5 px-2 py-1.5 rounded text-sm transition-colors text-left w-full",
                    selectedFile === file.fullPath
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "hover:bg-accent hover:text-accent-foreground"
                  )}
                  onClick={() => handleFileClick(file.fullPath)}
                  data-testid={`button-browse-file-${file.name}`}
                >
                  <Film className="w-4 h-4 shrink-0 text-primary" />
                  <span className="truncate flex-1">{file.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                </button>
              ))}

              {browseData.dirs.length === 0 && browseData.files.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No video files or folders found here.
                </p>
              )}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="p-5 pt-3 border-t shrink-0 flex gap-2 justify-between items-center">
          <span className="text-xs text-muted-foreground truncate flex-1">
            {selectedFile ? selectedFile : "No file selected"}
          </span>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={onClose} data-testid="button-browse-cancel">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!selectedFile}
              onClick={() => selectedFile && onSelect(selectedFile)}
              data-testid="button-browse-select"
            >
              Select file
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// ClipCard
// ─────────────────────────────────────────────

function ClipCard({ clip, onDelete }: { clip: Clip; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="hover-elevate" data-testid={`card-clip-${clip.id}`}>
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">{clip.duration}s clip</span>
            <span className="text-xs text-muted-foreground">
              {formatTime(clip.startTime)} – {formatTime(clip.endTime)}
            </span>
            {clip.outputFormat && clip.outputFormat !== "original" && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">
                {clip.outputFormat}
              </Badge>
            )}
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

        <Progress value={clip.energyLevel} className="h-1" />

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
            className="w-full rounded-md bg-black max-h-[360px] object-contain"
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

// ─────────────────────────────────────────────
// UploadCard
// ─────────────────────────────────────────────

function UploadCard({ upload, onDelete }: { upload: Upload; onDelete: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedDurations, setSelectedDurations] = useState<ClipDuration[]>([15]);
  const [maxClips, setMaxClips]         = useState<string>("");
  const [buildUp, setBuildUp]           = useState<BuildUp>("short");
  const [sensitivity, setSensitivity]   = useState<Sensitivity>("balanced");
  const [recordingType, setRecording]   = useState<RecordingType>("auto");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("original");
  const [cropMethod, setCropMethod]     = useState<CropMethod>("blur");
  const [showClips, setShowClips]       = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isGenerating = upload.status === "generating";

  const { data: clips = [] } = useQuery<Clip[]>({
    queryKey: ["/api/uploads", upload.id, "clips"],
    queryFn: () => fetch(`/api/uploads/${upload.id}/clips`).then(r => r.json()),
    refetchInterval: isGenerating ? 4000 : false,
    enabled: upload.status === "analyzed" || isGenerating || showClips,
  });

  const prevClipCount = useRef(0);
  useEffect(() => {
    if (clips.length > 0 && prevClipCount.current === 0) setShowClips(true);
    prevClipCount.current = clips.length;
  }, [clips.length]);

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

  const sourceFormat = (upload.videoWidth && upload.videoHeight)
    ? detectFormat(upload.videoWidth, upload.videoHeight)
    : null;
  const needsConversion = outputFormat !== "original" && outputFormat !== sourceFormat;

  const generateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/uploads/${upload.id}/generate`, {
        durations: selectedDurations,
        maxClips: maxClipsNumber > 0 ? maxClipsNumber : 0,
        buildUp,
        sensitivity,
        recordingType,
        outputFormat,
        cropMethod,
      }),
    onSuccess: () => {
      const limitText = maxClipsNumber > 0 ? `top ${maxClipsNumber}` : "all";
      toast({
        title: "Generating clips…",
        description: `Encoding ${limitText} highlight moments. Clips appear as they're ready.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteClipMutation = useMutation({
    mutationFn: (clipId: string) => apiRequest("DELETE", `/api/clips/${clipId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/uploads", upload.id, "clips"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/uploads/${upload.id}/stop`, {}),
    onSuccess: () => {
      toast({ title: "Stopping…", description: "Finishing the current clip then stopping." });
      queryClient.invalidateQueries({ queryKey: ["/api/uploads"] });
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
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <p className="font-semibold text-foreground truncate text-sm" data-testid={`text-filename-${upload.id}`}>
              {upload.filename}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {upload.duration > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDuration(upload.duration)}
                </p>
              )}
              {upload.videoWidth && upload.videoHeight && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <MonitorSmartphone className="w-3 h-3" />
                  {upload.videoWidth}×{upload.videoHeight}
                  {sourceFormat && sourceFormat !== "original" && (
                    <span className="ml-1 text-muted-foreground/70">({sourceFormat})</span>
                  )}
                </p>
              )}
            </div>
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

        {/* Generate controls */}
        {upload.status === "analyzed" && (
          <div className="flex flex-col gap-4">

            {/* Clip durations */}
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

            {/* Build-up */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Build-up before the drop</p>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  { value: "none",   label: "None" },
                  { value: "short",  label: "Short" },
                  { value: "medium", label: "Medium" },
                  { value: "long",   label: "Long" },
                  { value: "auto",   label: "DJ Choice" },
                ] as const).map(opt => (
                  <Button
                    key={opt.value}
                    variant={buildUp === opt.value ? "default" : "outline"}
                    size="sm"
                    className="text-xs h-7 px-2.5"
                    onClick={() => setBuildUp(opt.value)}
                    data-testid={`button-buildup-${opt.value}-${upload.id}`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground/70 mt-1.5">
                {buildUp === "none"   && "Clip starts at the drop. No build-up included."}
                {buildUp === "short"  && "~20% of clip is build-up before the drop."}
                {buildUp === "medium" && "~40% of clip is build-up before the drop."}
                {buildUp === "long"   && "~65% of clip is build-up before the drop."}
                {buildUp === "auto"   && "Automatically longer build-up for stronger peaks, shorter for the rest."}
              </p>
            </div>

            {/* Maximum clips */}
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

            {/* Advanced options toggle */}
            <Button
              variant="ghost"
              size="sm"
              className="justify-start px-0 gap-1.5 text-xs text-muted-foreground h-auto"
              onClick={() => setShowAdvanced(v => !v)}
              data-testid={`button-advanced-toggle-${upload.id}`}
            >
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showAdvanced ? "Hide advanced options" : "Show advanced options"}
            </Button>

            {/* Advanced options — Recording type, Sensitivity, Output format */}
            {showAdvanced && (
              <div className="flex flex-col gap-4 border-l-2 border-border/50 pl-4">

                {/* Recording type */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Recording type</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {([
                      { value: "cable", label: "Cable-in",    icon: <Cable className="w-3 h-3" /> },
                      { value: "mic",   label: "Mic / Phone", icon: <Mic className="w-3 h-3" /> },
                      { value: "auto",  label: "Auto-detect", icon: <Cpu className="w-3 h-3" /> },
                    ] as const).map(opt => (
                      <Button
                        key={opt.value}
                        variant={recordingType === opt.value ? "default" : "outline"}
                        size="sm"
                        className="text-xs h-7 px-2.5 gap-1.5"
                        onClick={() => setRecording(opt.value)}
                        data-testid={`button-recording-${opt.value}-${upload.id}`}
                      >
                        {opt.icon}
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-1.5">
                    {recordingType === "cable" && "Heavy bass weighting — best for mixer line-out or interface recordings."}
                    {recordingType === "mic"   && "Balanced weighting — handles room acoustics and inconsistent bass."}
                    {recordingType === "auto"  && "Automatically decides between cable and mic weighting from the signal."}
                  </p>
                </div>

                {/* Sensitivity */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Detection sensitivity</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {([
                      { value: "conservative", label: "Conservative" },
                      { value: "balanced",     label: "Balanced"     },
                      { value: "aggressive",   label: "Aggressive"   },
                    ] as const).map(opt => (
                      <Button
                        key={opt.value}
                        variant={sensitivity === opt.value ? "default" : "outline"}
                        size="sm"
                        className="text-xs h-7 px-2.5"
                        onClick={() => setSensitivity(opt.value)}
                        data-testid={`button-sensitivity-${opt.value}-${upload.id}`}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-1.5">
                    {sensitivity === "conservative" && "Fewer clips, only the most obvious drops (top 30% energy)."}
                    {sensitivity === "balanced"     && "Good balance for most recordings (top 40% energy)."}
                    {sensitivity === "aggressive"   && "More clips, catches quieter transitions (top 55% energy)."}
                  </p>
                </div>

                {/* Output format */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Output format</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {([
                      { value: "original", label: "No change" },
                      { value: "9:16",     label: "9:16",  sub: "Reels / TikTok" },
                      { value: "4:5",      label: "4:5",   sub: "Instagram" },
                      { value: "1:1",      label: "1:1",   sub: "Square" },
                      { value: "3:4",      label: "3:4",   sub: "Portrait" },
                      { value: "16:9",     label: "16:9",  sub: "YouTube" },
                    ] as const).map(opt => {
                      const isSourceFormat = sourceFormat && opt.value !== "original" && opt.value === sourceFormat;
                      return (
                        <Button
                          key={opt.value}
                          variant={outputFormat === opt.value ? "default" : "outline"}
                          size="sm"
                          className="text-xs h-auto px-2.5 py-1 flex flex-col items-center gap-0 leading-tight"
                          onClick={() => setOutputFormat(opt.value)}
                          data-testid={`button-format-${opt.value}-${upload.id}`}
                        >
                          <span>{opt.label}</span>
                          {"sub" in opt && (
                            <span className={cn("text-[10px] font-normal", outputFormat === opt.value ? "text-primary-foreground/70" : "text-muted-foreground")}>
                              {isSourceFormat ? "✓ original" : opt.sub}
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>

                  {sourceFormat && sourceFormat !== "original" && outputFormat === "original" && (
                    <p className="text-xs text-muted-foreground/70 mt-1.5">
                      Detected source: <strong>{sourceFormat}</strong>. Select a format above to convert.
                    </p>
                  )}

                  {needsConversion && (
                    <div className="mt-3 flex flex-col gap-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Fit method <span className="font-normal text-muted-foreground/70">(source → {outputFormat})</span>
                      </p>
                      <div className="flex gap-1.5">
                        <Button
                          variant={cropMethod === "blur" ? "default" : "outline"}
                          size="sm"
                          className="text-xs h-7 px-2.5"
                          onClick={() => setCropMethod("blur")}
                          data-testid={`button-cropmethod-blur-${upload.id}`}
                        >
                          Blur background
                        </Button>
                        <Button
                          variant={cropMethod === "crop" ? "default" : "outline"}
                          size="sm"
                          className="text-xs h-7 px-2.5"
                          onClick={() => setCropMethod("crop")}
                          data-testid={`button-cropmethod-crop-${upload.id}`}
                        >
                          Center crop
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground/70">
                        {cropMethod === "blur"
                          ? "Full frame visible, blurred copy fills the background. Preserves everything in shot."
                          : "Crops to fill the frame from center. May cut edges — good if subject is centred."}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

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

        {/* Generating progress + stop button */}
        {isGenerating && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span>
                {clips.length > 0
                  ? `${clips.length} clip${clips.length > 1 ? "s" : ""} ready so far — still encoding…`
                  : "Analysing audio and encoding clips…"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-7 shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              data-testid={`button-stop-${upload.id}`}
            >
              <Square className="w-3 h-3" />
              Stop
            </Button>
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

// ─────────────────────────────────────────────
// Home page
// ─────────────────────────────────────────────

export default function Home() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showBrowser, setShowBrowser]   = useState(false);
  const [openingPicker, setOpeningPicker] = useState(false);

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
      toast({ title: "File added!", description: "Reading video info and preparing analysis…" });
      setShowBrowser(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add file", description: err.message, variant: "destructive" });
      setShowBrowser(false);
    },
  });

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
                { icon: <FolderOpen className="w-4 h-4" />, label: "Browse your set" },
                { icon: <ArrowRight className="w-3 h-3 text-muted-foreground" />, label: null },
                { icon: <Music2 className="w-4 h-4" />, label: "Detect drops & peaks" },
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

        {/* Add set button */}
        <div>
          <Button
            size="lg"
            className="gap-2 w-full sm:w-auto"
            disabled={localPathMutation.isPending || openingPicker}
            onClick={async () => {
              setOpeningPicker(true);
              try {
                const res = await fetch("/api/browse-native", { method: "POST" });
                if (!res.ok) {
                  // Not on Windows or picker failed — fall back to tree browser
                  setShowBrowser(true);
                  return;
                }
                const { filePath } = await res.json();
                if (filePath) {
                  localPathMutation.mutate(filePath);
                }
                // if filePath is null the user cancelled — do nothing
              } catch {
                // Network error or not available — fall back
                setShowBrowser(true);
              } finally {
                setOpeningPicker(false);
              }
            }}
            data-testid="button-browse-open"
          >
            {localPathMutation.isPending || openingPicker ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FolderOpen className="w-4 h-4" />
            )}
            {localPathMutation.isPending
              ? "Registering file…"
              : openingPicker
              ? "Opening file picker…"
              : "Browse & add DJ set"}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Opens a file picker — select your video file directly. No transfer needed.
          </p>
        </div>

        {/* Tree browser modal (fallback for non-Windows) */}
        <FileBrowserModal
          open={showBrowser}
          onClose={() => setShowBrowser(false)}
          onSelect={(filePath) => localPathMutation.mutate(filePath)}
        />

        {/* Upload list */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : uploads.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Music2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No sets added yet. Browse to add your first DJ set recording.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground">
              Your sets ({uploads.length})
            </h2>
            {uploads.map(upload => (
              <UploadCard
                key={upload.id}
                upload={upload}
                onDelete={(id) => deleteUploadMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
