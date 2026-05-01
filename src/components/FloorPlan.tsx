"use client";

import { motion } from "framer-motion";
import { APT_TARGETS, type Plan, type Room } from "@/lib/generator";

type Props = {
  plan: Plan;
  size?: number;        // max viewport size in px
  showLabels?: boolean;
  showScale?: boolean;
  compact?: boolean;
  variantBadge?: boolean;
};

const KIND_FILL: Record<Room["kind"], string> = {
  apt: "#a78bfa",
  core: "#1f2937",
  corridor: "#0f172a",
  service: "#374151",
};

function roomFill(r: Room) {
  if (r.kind === "apt" && r.apt) return APT_TARGETS[r.apt].color;
  return KIND_FILL[r.kind];
}

export function FloorPlan({
  plan,
  size = 720,
  showLabels = true,
  showScale = true,
  compact = false,
  variantBadge = false,
}: Props) {
  const padding = compact ? 8 : 24;
  const sw = plan.site.w;
  const sh = plan.site.h;
  const aspect = sw / sh;
  const viewW = size;
  const viewH = size / aspect;

  const stroke = compact ? 0.3 : 0.18;
  const labelFontSize = compact ? 1.6 : 1.4;

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={`${-padding / 10} ${-padding / 10} ${sw + padding / 5} ${sh + padding / 5}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
      >
        <defs>
          <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.05" />
          </pattern>
          <pattern id="hatch" width="0.8" height="0.8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="0.8" stroke="rgba(255,255,255,0.18)" strokeWidth="0.12" />
          </pattern>
          <linearGradient id="siteGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
          </linearGradient>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.4" />
            <feOffset dx="0" dy="0.3" result="off" />
            <feComponentTransfer><feFuncA type="linear" slope="0.5" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* site */}
        <rect x="0" y="0" width={sw} height={sh} fill="url(#siteGrad)" stroke="rgba(255,255,255,0.18)" strokeWidth={stroke * 1.2} strokeDasharray="0.8 0.6" rx="0.4" />
        <rect x="0" y="0" width={sw} height={sh} fill="url(#grid)" />

        {/* building footprint outline */}
        <motion.rect
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          x={plan.building.x}
          y={plan.building.y}
          width={plan.building.w}
          height={plan.building.h}
          fill="rgba(0,0,0,0.35)"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={stroke}
          rx="0.2"
        />

        {/* rooms */}
        {plan.rooms.map((r, i) => {
          const fill = roomFill(r);
          const isApt = r.kind === "apt";
          const isCore = r.kind === "core";
          const isCorr = r.kind === "corridor";
          return (
            <motion.g
              key={r.id}
              initial={{ opacity: 0, y: 0.3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.012 }}
            >
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill={fill}
                fillOpacity={isApt ? 0.22 : isCorr ? 0.4 : 0.5}
                stroke={fill}
                strokeOpacity={isApt ? 0.85 : 0.7}
                strokeWidth={stroke}
                rx="0.12"
              />
              {isCore && (
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="url(#hatch)" />
              )}
              {showLabels && isApt && r.h > 2.6 && (() => {
                const shortLabel = r.apt === "studio" ? "СТ"
                  : r.apt === "k1" ? "1К"
                  : r.apt === "k2" ? "2К"
                  : "3К";
                const isNarrow = r.w < 5.4;
                const fs = isNarrow ? Math.max(0.95, r.w * 0.22) : labelFontSize;
                const showFull = r.w >= 4.6;
                return (
                  <>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 - (isNarrow ? 0.05 : 0.2)}
                      textAnchor="middle"
                      fontSize={fs}
                      fill="rgba(255,255,255,0.95)"
                      fontWeight={600}
                      fontFamily="var(--font-geist-sans), sans-serif"
                      letterSpacing={isNarrow ? "0.04em" : "0"}
                    >
                      {showFull ? r.label : shortLabel}
                    </text>
                    {r.w >= 3.6 && r.h > 3.2 && (
                      <text
                        x={r.x + r.w / 2}
                        y={r.y + r.h / 2 + fs * 0.95}
                        textAnchor="middle"
                        fontSize={fs * 0.78}
                        fill="rgba(255,255,255,0.6)"
                        fontFamily="var(--font-geist-mono), monospace"
                      >
                        {r.area}
                      </text>
                    )}
                  </>
                );
              })()}
              {showLabels && isCore && r.w > 3 && r.h > 3 && (
                <text
                  x={r.x + r.w / 2}
                  y={r.y + r.h / 2}
                  textAnchor="middle"
                  fontSize={labelFontSize * 0.95}
                  fill="rgba(255,255,255,0.85)"
                  fontWeight={500}
                  letterSpacing="0.04em"
                >
                  ЛЛУ
                </text>
              )}
            </motion.g>
          );
        })}

        {/* North arrow */}
        {showScale && (
          <g transform={`translate(${sw - 4}, ${2.5})`}>
            <circle r="1.6" fill="rgba(0,0,0,0.5)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.1" />
            <path d="M 0 -1 L 0.5 0.6 L 0 0.2 L -0.5 0.6 Z" fill="rgba(255,255,255,0.85)" />
            <text x="0" y="-1.9" textAnchor="middle" fontSize="1.1" fill="rgba(255,255,255,0.6)" fontWeight={600}>N</text>
          </g>
        )}

        {/* scale bar */}
        {showScale && (
          <g transform={`translate(${1.5}, ${sh - 1.6})`}>
            <rect width="10" height="0.4" fill="rgba(255,255,255,0.6)" />
            <rect x="2" width="2" height="0.4" fill="rgba(0,0,0,0.7)" />
            <rect x="6" width="2" height="0.4" fill="rgba(0,0,0,0.7)" />
            <text y="-0.4" fontSize="0.9" fill="rgba(255,255,255,0.55)" fontFamily="var(--font-geist-mono), monospace">0          10 м</text>
          </g>
        )}
      </svg>

      {variantBadge && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wider uppercase glass text-white/70">
          {plan.variant === "double-loaded" ? "Секция" : plan.variant === "single-loaded" ? "Галерея" : "Башня"}
        </div>
      )}
    </div>
  );
}
