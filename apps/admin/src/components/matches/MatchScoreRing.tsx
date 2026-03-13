import { cn } from "@/lib/utils";
import { getSimilarityMeta } from "./match-meta";

interface MatchScoreRingProps {
  similarity: number;
  size?: number;
  showLabel?: boolean;
}

export function MatchScoreRing({ similarity, size = 140, showLabel = true }: MatchScoreRingProps) {
  const { percentage, label } = getSimilarityMeta(similarity);
  
  const strokeWidth = 6;
  const gap = 3;

  // Outer ring parameters (+10%)
  const valOuter = Math.min(100, percentage + 10);
  const radiusOuter = (size - strokeWidth) / 2;
  const circumferenceOuter = 2 * Math.PI * radiusOuter;
  const offsetOuter = circumferenceOuter - (valOuter / 100) * circumferenceOuter;

  // Middle ring parameters (Exact)
  const radiusMiddle = radiusOuter - strokeWidth - gap;
  const circumferenceMiddle = 2 * Math.PI * radiusMiddle;
  const offsetMiddle = circumferenceMiddle - (percentage / 100) * circumferenceMiddle;

  // Inner ring parameters (-10%)
  const valInner = Math.max(0, Math.floor(percentage - 10)); // Math.floor in case it went below somehow, though percentage is integer
  const radiusInner = radiusMiddle - strokeWidth - gap;
  const circumferenceInner = 2 * Math.PI * radiusInner;
  const offsetInner = circumferenceInner - (valInner / 100) * circumferenceInner;

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center rounded-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-sky-50/50 via-white to-sky-100/60 dark:from-slate-900/20 dark:via-background dark:to-slate-900/40" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {/* Outer Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radiusOuter}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-100 dark:text-slate-800/60"
          />
          {/* Middle Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radiusMiddle}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-100 dark:text-slate-800/60"
          />
          {/* Inner Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radiusInner}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-slate-100 dark:text-slate-800/60"
          />
          
          {/* Outer Progress (Light Blue, +10%) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radiusOuter}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumferenceOuter}
            strokeDashoffset={offsetOuter}
            className="text-[#93c5fd] dark:text-blue-400 transition-all duration-1000 ease-out"
          />
          
          {/* Middle Progress (Main Blue, Exact) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radiusMiddle}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumferenceMiddle}
            strokeDashoffset={offsetMiddle}
            className="text-[#6bb5ff] dark:text-blue-500 transition-all duration-1000 ease-out delay-75"
          />

          {/* Inner Progress (Dark Blue, -10%) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radiusInner}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumferenceInner}
            strokeDashoffset={offsetInner}
            className="text-[#0a4fab] dark:text-blue-700 transition-all duration-1000 ease-out delay-150"
          />
        </svg>
        
        {/* Center Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-black tracking-tighter text-[#0ea5e9]">
            {percentage}%
          </span>
        </div>
      </div>
      {showLabel ? <p className="mt-2 text-center text-xs font-black uppercase tracking-widest text-[#0a4fab]">{label}</p> : null}
    </div>
  );
}
