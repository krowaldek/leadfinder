import { cn } from "@/lib/utils";
import { getSimilarityMeta } from "./match-meta";

interface MatchScoreRingProps {
  similarity: number;
  size?: number;
  showLabel?: boolean;
}

export function MatchScoreRing({ similarity, size = 96, showLabel = true }: MatchScoreRingProps) {
  const { percentage, label, textTone } = getSimilarityMeta(similarity);
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-primary/10"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#match-score-gradient)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
          <defs>
            <linearGradient id="match-score-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(59 130 246)" />
              <stop offset="100%" stopColor="rgb(99 102 241)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-background/80 backdrop-blur-sm">
          <span className={cn("text-xl font-semibold tracking-tight", textTone)}>{percentage}%</span>
          <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            match
          </span>
        </div>
      </div>
      {showLabel ? <p className="text-center text-xs text-muted-foreground">{label}</p> : null}
    </div>
  );
}
