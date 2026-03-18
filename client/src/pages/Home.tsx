import { useState, useRef, useEffect, useMemo } from "react";
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
  Sliders,
  AlertTriangle,
  PlusCircle,
  RefreshCcw,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const PRESET_DURATIONS = [15, 20, 30, 45] as const;
type ClipDuration = number; // any positive integer

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
  const [pathInput, setPathInput] = useState<string>("");

  const { data: browseData, isLoading: isBrowsing, error: browseError } = useQuery<BrowseResponse>({
    queryKey: ["/api/browse", browsePath],
    queryFn: () =>
      fetch(`/api/browse${browsePath ? `?path=${encodeURIComponent(browsePath)}` : ""}`)
        .then(r => r.json()),
    enabled: open,
  });

  // Sync path input with current directory
  useEffect(() => {
    if (browseData?.path) setPathInput(browseData.path);
  }, [browseData?.path]);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setBrowsePath("");
      setSelectedFile(null);
    }
  }, [open]);

  const navigateTo = (p: string) => {
    setBrowsePath(p);
    setSelectedFile(null);
  };

  const handleDirClick = (dir: string) => {
    if (!browseData) return;
    const sep = browseData.path.includes("\\") ? "\\" : "/";
    navigateTo(browseData.path + sep + dir);
  };

  const handleParentClick = () => {
    if (browseData?.parent) navigateTo(browseData.parent);
  };

  const handleFileClick = (fullPath: string) => {
    setSelectedFile(prev => prev === fullPath ? null : fullPath);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = pathInput.trim();
    if (trimmed) navigateTo(trimmed);
  };

  // Build breadcrumb segments
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
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="p-5 pb-3 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-primary" />
            Select your DJ set
          </DialogTitle>
          <DialogDescription className="sr-only">
            Navigate your file system to find and select a video file.
          </DialogDescription>

          {/* Path input — paste any folder or file path and press Enter */}
          <form onSubmit={handlePathSubmit} className="flex gap-2 mt-3">
            <Input
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              placeholder={isWin ? "e.g. C:\\Users\\jgarr\\Videos" : "/home/user/videos"}
              className="text-xs h-8 font-mono"
              data-testid="input-browse-path"
            />
            <Button type="submit" size="sm" variant="outline" className="h-8 shrink-0">
              Go
            </Button>
          </form>

          {/* Breadcrumb */}
          {browseData && (
            <div className="flex items-center gap-1 flex-wrap mt-2">
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => navigateTo("")}>
                <HomeIcon className="w-3 h-3" />
              </Button>
              {segments.map((seg, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs"
                    onClick={() => navigateTo(seg.path)}
                  >
                    {seg.label}
                  </Button>
                </span>
              ))}
            </div>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 px-5 min-h-0" style={{ maxHeight: "55vh" }}>
          {isBrowsing && (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}

          {browseError && (
            <div className="text-destructive text-sm py-4 text-center">
              Could not read that path. Check it's correct and try again.
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
                  <span className="italic">.. (up one folder)</span>
                </button>
              )}

              {/* Directories */}
              {browseData.dirs.map(dir => (
                <button
                  key={dir}
                  className="flex items-center gap-2.5 px-2 py-2 rounded text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left w-full"
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
                    "flex items-center gap-2.5 px-2 py-2 rounded text-sm transition-colors text-left w-full",
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

function ClipCard({
  clip,
  onDelete,
  label,
  upload,
}: {
  clip: Clip;
  onDelete: (id: string) => void;
  label: string;
  upload: Upload;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [recutOpen, setRecutOpen] = useState(false);

  // Re-cut settings (default to the clip's own settings)
  const [recutDur, setRecutDur] = useState<number>(clip.duration);
  const [recutCustomStr, setRecutCustomStr] = useState("");
  const [showRecutCustom, setShowRecutCustom] = useState(false);
  const [recutBuildUp, setRecutBuildUp] = useState<BuildUp>("short");
  const [recutFormat, setRecutFormat] = useState<OutputFormat>(
    (clip.outputFormat as OutputFormat) ?? "original"
  );
  const [recutCrop, setRecutCrop] = useState<CropMethod>("blur");

  const recutCustomNum = parseInt(recutCustomStr, 10);
  const recutCustomValid = showRecutCustom && !isNaN(recutCustomNum) && recutCustomNum >= 3 && recutCustomNum <= 3600;
  const finalRecutDur = recutCustomValid ? recutCustomNum : recutDur;

  const sourceFormat = upload.videoWidth && upload.videoHeight
    ? detectFormat(upload.videoWidth, upload.videoHeight)
    : null;
  const recutNeedsConversion = recutFormat !== "original" && recutFormat !== sourceFormat;

  const variantMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/clips/${clip.id}/variant`, {
        duration: finalRecutDur,
        buildUp: recutBuildUp,
        outputFormat: recutFormat,
        cropMethod: recutCrop,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/uploads", clip.uploadId, "clips"] });
      setRecutOpen(false);
      toast({ title: "Variant created!", description: `New ${finalRecutDur}s clip generated from the same moment.` });
    },
    onError: (err: Error) => {
      toast({ title: "Re-cut failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="hover-elevate flex flex-col" data-testid={`card-clip-${clip.id}`}>
      <CardContent className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-foreground">{label}</span>
            <span className="text-xs text-muted-foreground">
              {formatTime(clip.startTime)} – {formatTime(clip.endTime)}
            </span>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {clip.outputFormat && clip.outputFormat !== "original" && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">
                  {clip.outputFormat}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 capitalize">
                {clip.highlightType}
              </Badge>
            </div>
          </div>
          <div
            className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
            data-testid={`text-energy-${clip.id}`}
          >
            <Zap className="w-3 h-3 text-chart-4" />
            {clip.energyLevel}%
          </div>
        </div>

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
          <div className="flex justify-center">
            <video
              controls
              className="rounded-md bg-black max-h-[360px] max-w-full w-auto"
              src={`/api/clips/${clip.id}/stream`}
              data-testid={`video-preview-${clip.id}`}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 mt-auto">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 gap-1.5 text-xs"
            asChild
            data-testid={`button-download-${clip.id}`}
          >
            <a href={`/api/clips/${clip.id}/download`} download>
              <Download className="w-3 h-3" />
              Download
            </a>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs px-2.5"
            onClick={() => setRecutOpen(true)}
            data-testid={`button-recut-${clip.id}`}
          >
            <RefreshCcw className="w-3 h-3" />
            Re-cut
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="shrink-0 text-destructive h-8 w-8"
            onClick={() => onDelete(clip.id)}
            data-testid={`button-delete-clip-${clip.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>

      {/* Re-cut Dialog */}
      <Dialog open={recutOpen} onOpenChange={setRecutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCcw className="w-4 h-4 text-primary" />
              Re-cut this moment
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Same peak at {formatTime(clip.peakTime ?? clip.startTime)}, new settings.
              The new clip will appear alongside this one.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1">
            {/* Duration */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Duration</p>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_DURATIONS.map(d => (
                  <Button
                    key={d}
                    size="sm"
                    variant={!showRecutCustom && recutDur === d ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    onClick={() => { setRecutDur(d); setShowRecutCustom(false); }}
                    data-testid={`button-recut-dur-${d}-${clip.id}`}
                  >
                    {d}s
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={showRecutCustom ? "default" : "outline"}
                  className="text-xs h-7 px-2.5"
                  onClick={() => setShowRecutCustom(v => !v)}
                  data-testid={`button-recut-custom-${clip.id}`}
                >
                  Custom
                </Button>
              </div>
              {showRecutCustom && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min={3}
                    max={3600}
                    placeholder="e.g. 60"
                    value={recutCustomStr}
                    onChange={e => setRecutCustomStr(e.target.value)}
                    className="w-24 h-7 rounded-md border border-input bg-background px-2 text-sm"
                    data-testid={`input-recut-custom-${clip.id}`}
                  />
                  <span className="text-xs text-muted-foreground">seconds</span>
                </div>
              )}
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
                    size="sm"
                    variant={recutBuildUp === opt.value ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    onClick={() => setRecutBuildUp(opt.value)}
                    data-testid={`button-recut-buildup-${opt.value}-${clip.id}`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Output format */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Output format</p>
              <div className="flex gap-1.5 flex-wrap">
                {([
                  { value: "original", label: "No change" },
                  { value: "9:16",     label: "9:16" },
                  { value: "4:5",      label: "4:5" },
                  { value: "1:1",      label: "1:1" },
                  { value: "3:4",      label: "3:4" },
                  { value: "16:9",     label: "16:9" },
                ] as const).map(opt => (
                  <Button
                    key={opt.value}
                    size="sm"
                    variant={recutFormat === opt.value ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    onClick={() => setRecutFormat(opt.value)}
                    data-testid={`button-recut-format-${opt.value}-${clip.id}`}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              {recutNeedsConversion && (
                <div className="flex gap-1.5 mt-2">
                  <Button
                    size="sm"
                    variant={recutCrop === "blur" ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    onClick={() => setRecutCrop("blur")}
                  >
                    Blur background
                  </Button>
                  <Button
                    size="sm"
                    variant={recutCrop === "crop" ? "default" : "outline"}
                    className="text-xs h-7 px-2.5"
                    onClick={() => setRecutCrop("crop")}
                  >
                    Center crop
                  </Button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setRecutOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={variantMutation.isPending || (showRecutCustom && !recutCustomValid)}
              onClick={() => variantMutation.mutate()}
              data-testid={`button-recut-submit-${clip.id}`}
            >
              {variantMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Scissors className="w-3 h-3" />
              )}
              Generate variant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─────────────────────────────────────────────
// ClipGroup — horizontal row of clips from the same peak moment
// ─────────────────────────────────────────────

function ClipGroup({
  groupIndex,
  clips,
  upload,
  onDeleteClip,
}: {
  groupIndex: number;
  clips: Clip[];
  upload: Upload;
  onDeleteClip: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => { checkScroll(); }, [clips.length]);

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -300 : 300, behavior: "smooth" });
  };

  const topClip = clips[0];
  const isSingle = clips.length === 1;

  return (
    <div className="flex flex-col gap-2">
      {/* Group header */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          Moment #{groupIndex + 1}
        </span>
        <span className="text-xs text-muted-foreground">
          @ {formatTime(topClip.peakTime ?? topClip.startTime)}
        </span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Zap className="w-3 h-3 text-chart-4" />
          {topClip.energyLevel}%
        </div>
        {clips.length > 1 && (
          <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 ml-auto">
            {clips.length} variants
          </Badge>
        )}
      </div>

      {/* Clips row */}
      <div className="relative">
        {canScrollLeft && (
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-background border border-border shadow flex items-center justify-center -ml-3"
            onClick={() => scroll("left")}
            aria-label="Scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pb-1"
          style={{ scrollbarWidth: "thin" }}
          onScroll={checkScroll}
        >
          {clips.map((clip, idx) => (
            <div
              key={clip.id}
              className="flex-none"
              style={{ width: isSingle ? "100%" : "min(280px, 80vw)" }}
            >
              <ClipCard
                clip={clip}
                label={idx === 0 ? `${clip.duration}s clip` : `Variant: ${clip.duration}s${clip.outputFormat && clip.outputFormat !== "original" ? ` · ${clip.outputFormat}` : ""}`}
                onDelete={onDeleteClip}
                upload={upload}
              />
            </div>
          ))}
        </div>
        {canScrollRight && (
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-background border border-border shadow flex items-center justify-center -mr-3"
            onClick={() => scroll("right")}
            aria-label="Scroll right"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// UploadCard
// ─────────────────────────────────────────────

function UploadCard({ upload, onDelete }: { upload: Upload; onDelete: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedDurations, setSelectedDurations] = useState<ClipDuration[]>([15]);
  const [customDurStr, setCustomDurStr]   = useState<string>("");
  const [showCustomDur, setShowCustomDur] = useState(false);
  const [maxClips, setMaxClips]         = useState<string>("");
  const [buildUp, setBuildUp]           = useState<BuildUp>("short");
  const [sensitivity, setSensitivity]   = useState<Sensitivity>("balanced");
  const [recordingType, setRecording]   = useState<RecordingType>("auto");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("original");
  const [cropMethod, setCropMethod]     = useState<CropMethod>("blur");
  const [showClips, setShowClips]         = useState(false);
  const [showAdvanced, setShowAdvanced]   = useState(false);
  const [showSettings, setShowSettings]   = useState(true);
  const [moreCount, setMoreCount]         = useState<string>("5");
  const [showRegenWarning, setShowRegenWarning] = useState(false);

  const settingsRef        = useRef<HTMLDivElement>(null);
  const moreClipsSectionRef = useRef<HTMLDivElement>(null);

  type GenerateSettings = {
    durations: ClipDuration[];
    maxClips: number;
    buildUp: BuildUp;
    sensitivity: Sensitivity;
    recordingType: RecordingType;
    outputFormat: OutputFormat;
    cropMethod: CropMethod;
  };
  const [lastSettings, setLastSettings] = useState<GenerateSettings | null>(null);

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

  // When generation finishes, do one final clip refresh to catch any clip
  // saved in the last few milliseconds before status flipped to "analyzed".
  const prevIsGenerating = useRef(false);
  useEffect(() => {
    if (prevIsGenerating.current && !isGenerating) {
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/uploads", upload.id, "clips"] });
      }, 600);
    }
    prevIsGenerating.current = isGenerating;
  }, [isGenerating, queryClient, upload.id]);

  // When settings panel is revealed, scroll it into view
  useEffect(() => {
    if (showSettings && settingsRef.current) {
      setTimeout(() => settingsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
    }
  }, [showSettings]);

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

  // Custom duration
  const customDurNum = parseInt(customDurStr, 10);
  const customDurValid = showCustomDur && !isNaN(customDurNum) && customDurNum >= 3 && customDurNum <= 3600;
  // All active durations: presets + optional custom
  const allDurations: number[] = [
    ...selectedDurations.filter(d => (PRESET_DURATIONS as readonly number[]).includes(d)),
    ...(customDurValid ? [customDurNum] : []),
  ];

  // Poll generation progress for "Encoding clip X of Y"
  const { data: genProgress } = useQuery<{ current: number; total: number }>({
    queryKey: ["/api/uploads", upload.id, "progress"],
    queryFn: () => fetch(`/api/uploads/${upload.id}/progress`).then(r => r.json()),
    refetchInterval: isGenerating ? 2000 : false,
    enabled: isGenerating,
  });

  // Group clips by peakTime so variants appear side-by-side
  const clipGroups = useMemo(() => {
    const map = new Map<number, Clip[]>();
    for (const clip of clips) {
      const pt = clip.peakTime ?? 0;
      if (!map.has(pt)) map.set(pt, []);
      map.get(pt)!.push(clip);
    }
    return Array.from(map.entries()).sort((a: [number, Clip[]], b: [number, Clip[]]) => {
      const eA = Math.max(...a[1].map((c: Clip) => c.energyLevel));
      const eB = Math.max(...b[1].map((c: Clip) => c.energyLevel));
      return eB - eA;
    });
  }, [clips]);

  const sourceFormat = (upload.videoWidth && upload.videoHeight)
    ? detectFormat(upload.videoWidth, upload.videoHeight)
    : null;
  const needsConversion = outputFormat !== "original" && outputFormat !== sourceFormat;

  // Compare two settings objects field-by-field
  function settingsAreSame(a: GenerateSettings | null, b: GenerateSettings): boolean {
    if (!a) return false;
    return (
      [...a.durations].sort().join(",") === [...b.durations].sort().join(",") &&
      a.maxClips     === b.maxClips     &&
      a.buildUp      === b.buildUp      &&
      a.sensitivity  === b.sensitivity  &&
      a.recordingType === b.recordingType &&
      a.outputFormat  === b.outputFormat  &&
      a.cropMethod    === b.cropMethod
    );
  }

  const generateMutation = useMutation({
    mutationFn: (opts?: { append?: boolean; skipFirstN?: number }) => {
      const settings: GenerateSettings = {
        durations: allDurations,
        maxClips: maxClipsNumber,
        buildUp,
        sensitivity,
        recordingType,
        outputFormat,
        cropMethod,
      };
      setLastSettings(settings);
      setShowSettings(false);
      return apiRequest("POST", `/api/uploads/${upload.id}/generate`, {
        durations: settings.durations,
        maxClips: settings.maxClips > 0 ? settings.maxClips : 0,
        buildUp: settings.buildUp,
        sensitivity: settings.sensitivity,
        recordingType: settings.recordingType,
        outputFormat: settings.outputFormat,
        cropMethod: settings.cropMethod,
        append:     opts?.append     ?? false,
        skipFirstN: opts?.skipFirstN ?? 0,
      });
    },
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

  const moreCountNumber = moreCount.trim() === "" ? 5 : parseInt(moreCount, 10);

  const appendMutation = useMutation({
    mutationFn: () => {
      if (!lastSettings) return Promise.reject(new Error("No settings"));
      return apiRequest("POST", `/api/uploads/${upload.id}/generate`, {
        ...lastSettings,
        maxClips: lastSettings.maxClips > 0 ? lastSettings.maxClips : 0,
        append: true,
        moreCount: moreCountNumber > 0 ? moreCountNumber : 5,
      });
    },
    onSuccess: () => {
      toast({
        title: "Generating more clips…",
        description: `Adding ${moreCountNumber} more highlight moments.`,
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

  const togglePresetDuration = (d: number) => {
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
        {upload.status === "analyzed" && showSettings && (
          <div className="flex flex-col gap-4" ref={settingsRef}>

            {/* Clip durations */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Clip durations</p>
              <div className="flex gap-2 flex-wrap items-center">
                {PRESET_DURATIONS.map(d => (
                  <Button
                    key={d}
                    variant={selectedDurations.includes(d) ? "default" : "outline"}
                    size="sm"
                    onClick={() => togglePresetDuration(d)}
                    data-testid={`button-duration-${d}-${upload.id}`}
                  >
                    {d}s
                  </Button>
                ))}
                <Button
                  variant={showCustomDur ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setShowCustomDur(v => !v);
                    if (showCustomDur) setCustomDurStr("");
                  }}
                  data-testid={`button-duration-custom-${upload.id}`}
                >
                  Custom
                </Button>
                {showCustomDur && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={3}
                      max={3600}
                      placeholder="e.g. 60"
                      value={customDurStr}
                      onChange={e => setCustomDurStr(e.target.value)}
                      className="w-20 h-8 rounded-md border border-input bg-background px-2 text-sm"
                      data-testid={`input-custom-duration-${upload.id}`}
                    />
                    <span className="text-xs text-muted-foreground">s</span>
                    {customDurValid && (
                      <span className="text-xs text-green-600 font-medium">✓ {customDurNum}s</span>
                    )}
                  </div>
                )}
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
              variant="outline"
              size="sm"
              className="justify-start gap-1.5 text-xs h-7 text-muted-foreground border-dashed self-start"
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
              disabled={allDurations.length === 0 || generateMutation.isPending}
              onClick={() => {
                if (clips.length > 0) {
                  setShowRegenWarning(true);
                } else {
                  generateMutation.mutate({});
                }
              }}
              data-testid={`button-generate-${upload.id}`}
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Scissors className="w-4 h-4" />
              )}
              {maxClipsNumber > 0
                ? `Generate top ${maxClipsNumber} × ${allDurations.join(", ")}s`
                : `Generate all × ${allDurations.join(", ")}s`}
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
              <div className="flex flex-col gap-5">
                {clipGroups.map(([peakTime, groupClips], groupIdx) => (
                  <ClipGroup
                    key={peakTime}
                    groupIndex={groupIdx}
                    clips={groupClips}
                    upload={upload}
                    onDeleteClip={(id) => deleteClipMutation.mutate(id)}
                  />
                ))}
              </div>
            )}

            {/* Generate more / change settings — shown after generation finishes */}
            {!isGenerating && upload.status === "analyzed" && lastSettings && (
              <div className="border-t border-border/50 pt-3 flex flex-col gap-3" ref={moreClipsSectionRef}>
                <p className="text-xs font-medium text-foreground">Generate more clips</p>

                {/* Same settings row */}
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-muted-foreground shrink-0">Add</span>
                  <Input
                    type="number"
                    min={1}
                    value={moreCount}
                    onChange={e => setMoreCount(e.target.value)}
                    className="w-16 h-8 text-sm"
                    data-testid={`input-more-count-${upload.id}`}
                  />
                  <span className="text-xs text-muted-foreground shrink-0">more clips with the same settings</span>
                  <Button
                    size="sm"
                    className="h-8 text-xs px-3 gap-1.5"
                    disabled={appendMutation.isPending}
                    onClick={() => appendMutation.mutate()}
                    data-testid={`button-append-${upload.id}`}
                  >
                    {appendMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <PlusCircle className="w-3 h-3" />
                    )}
                    Add clips
                  </Button>
                </div>

                {/* Different settings button — prominent */}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 self-start text-sm"
                  onClick={() => setShowSettings(true)}
                  data-testid={`button-change-settings-${upload.id}`}
                >
                  <Sliders className="w-4 h-4" />
                  Generate with different settings
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Progress block — rendered BELOW clips */}
        {isGenerating && (
          <div className="flex flex-col gap-2">
            {lastSettings && (
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-medium text-foreground/70">Duration:</span> {lastSettings.durations.join(", ")}s</span>
                <span><span className="font-medium text-foreground/70">Max clips:</span> {lastSettings.maxClips > 0 ? lastSettings.maxClips : "all"}</span>
                <span><span className="font-medium text-foreground/70">Build-up:</span> {lastSettings.buildUp === "auto" ? "DJ Choice" : lastSettings.buildUp}</span>
                {lastSettings.outputFormat !== "original" && (
                  <span><span className="font-medium text-foreground/70">Format:</span> {lastSettings.outputFormat}</span>
                )}
                <span><span className="font-medium text-foreground/70">Sensitivity:</span> {lastSettings.sensitivity}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1" data-testid={`text-progress-${upload.id}`}>
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                <span>
                  {genProgress && genProgress.total > 0
                    ? `Encoding clip ${genProgress.current} of ${genProgress.total}…`
                    : clips.length > 0
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
          </div>
        )}

        {/* Warning: regenerating when clips already exist */}
        <Dialog open={showRegenWarning} onOpenChange={setShowRegenWarning}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Add more or replace existing clips?
              </DialogTitle>
              <DialogDescription className="text-sm leading-relaxed pt-1">
                You already have <strong>{clips.length}</strong> generated clip{clips.length !== 1 ? "s" : ""}.
                Do you want to keep them and add more, or delete them and generate new ones?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-col gap-2 sm:flex-col">

              {/* Keep + add more */}
              <Button
                className="w-full justify-start gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  setShowRegenWarning(false);
                  const current: GenerateSettings = {
                    durations: allDurations, maxClips: maxClipsNumber,
                    buildUp, sensitivity, recordingType, outputFormat, cropMethod,
                  };
                  if (settingsAreSame(lastSettings, current)) {
                    appendMutation.mutate();
                  } else {
                    generateMutation.mutate({ append: true });
                  }
                }}
              >
                <PlusCircle className="w-4 h-4" />
                Keep existing and add more
              </Button>

              {/* Delete + generate new */}
              <Button
                className="w-full justify-start gap-2 bg-red-600 hover:bg-red-700 text-white"
                onClick={() => {
                  setShowRegenWarning(false);
                  const current: GenerateSettings = {
                    durations: allDurations, maxClips: maxClipsNumber,
                    buildUp, sensitivity, recordingType, outputFormat, cropMethod,
                  };
                  if (settingsAreSame(lastSettings, current)) {
                    const clipsPerDur = allDurations.length > 0
                      ? Math.floor(clips.length / allDurations.length)
                      : clips.length;
                    generateMutation.mutate({ append: false, skipFirstN: clipsPerDur });
                  } else {
                    generateMutation.mutate({ append: false });
                  }
                }}
              >
                <Scissors className="w-4 h-4" />
                Delete existing and generate new
              </Button>

              {/* Cancel */}
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowRegenWarning(false)}
              >
                Cancel and go back
              </Button>

            </DialogFooter>
          </DialogContent>
        </Dialog>
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
  const [showBrowser, setShowBrowser]    = useState(false);
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
                  setShowBrowser(true);
                  return;
                }
                const { filePath } = await res.json();
                if (filePath) localPathMutation.mutate(filePath);
              } catch {
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
              ? "Adding file…"
              : openingPicker
              ? "Opening file picker…"
              : "Browse & add DJ set"}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Opens Windows file picker. Navigate to your video file, or paste its full path directly.
          </p>
        </div>

        <FileBrowserModal
          open={showBrowser}
          onClose={() => setShowBrowser(false)}
          onSelect={(filePath) => { localPathMutation.mutate(filePath); setShowBrowser(false); }}
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
