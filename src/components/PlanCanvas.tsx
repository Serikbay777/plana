"use client";

import {
  ENG_COLORS,
  ZONE_COLORS,
  type Plan,
  type PlacedTile,
  type PlacedZone,
  type Point,
  type Polygon,
  type ZoneKind,
} from "@/lib/engine";

type Props = {
  plan: Plan;
  showLabels?: boolean;
  showZones?: boolean;
  showFixtures?: boolean;
  showScale?: boolean;
  compact?: boolean;
  variantBadge?: string;
};

// ---- helpers --------------------------------------------------------------

function polyPath(p: Polygon): string {
  const pts = p.exterior;
  if (pts.length === 0) return "";
  return (
    `M ${pts[0].x} ${-pts[0].y}` +
    pts
      .slice(1)
      .map((pt) => ` L ${pt.x} ${-pt.y}`)
      .join("") +
    " Z"
  );
}

function bbox(p: Polygon): { minx: number; miny: number; maxx: number; maxy: number; w: number; h: number } {
  const xs = p.exterior.map((pt) => pt.x);
  const ys = p.exterior.map((pt) => pt.y);
  const minx = Math.min(...xs);
  const maxx = Math.max(...xs);
  const miny = Math.min(...ys);
  const maxy = Math.max(...ys);
  return { minx, miny, maxx, maxy, w: maxx - minx, h: maxy - miny };
}

function rectPath(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${-y} L ${x + w} ${-y} L ${x + w} ${-(y + h)} L ${x} ${-(y + h)} Z`;
}

// палитра пастелей для квартир — каждой свой цвет, как в реальных проектах
const APT_PALETTE = [
  "#fde68a", // amber
  "#bef264", // lime
  "#fdba74", // orange
  "#fbcfe8", // pink
  "#a5f3fc", // cyan
  "#c4b5fd", // violet
  "#f0abfc", // fuchsia
  "#86efac", // green
  "#fca5a5", // rose
  "#bae6fd", // sky
];

function aptColor(idx: number): string {
  // i*3 даёт «непоследовательное» чередование — соседи всегда разного цвета
  return APT_PALETTE[(idx * 3) % APT_PALETTE.length];
}

// ---- main component -------------------------------------------------------

export function PlanCanvas({
  plan,
  showLabels = true,
  showZones = true,
  showFixtures = true,
  showScale = true,
  compact = false,
  variantBadge,
}: Props) {
  const b = bbox(plan.floor_polygon);
  const pad = compact ? 1.5 : 3.5;
  const stroke = compact ? 0.18 : 0.1;

  const viewBox = `${b.minx - pad} ${-(b.miny + b.h) - pad} ${b.w + pad * 2} ${b.h + pad * 2}`;

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={viewBox}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
      >
        <defs>
          {/* несущая (огнестойкая) внешняя стена — красная штриховка */}
          <pattern id="bearing-wall" width="0.4" height="0.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="0.4" height="0.4" fill="rgba(220,38,38,0.6)" />
            <line x1="0" y1="0" x2="0" y2="0.4" stroke="rgba(255,255,255,0.55)" strokeWidth="0.16" />
          </pattern>
          {/* шахта / лестничная клетка — серая диагональ */}
          <pattern id="core-hatch" width="0.6" height="0.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="0.6" height="0.6" fill="rgba(60,60,70,0.5)" />
            <line x1="0" y1="0" x2="0" y2="0.6" stroke="rgba(255,255,255,0.18)" strokeWidth="0.12" />
          </pattern>
        </defs>

        {/* Контур этажа — внешние несущие стены толщиной 0.4 м */}
        <ExteriorWall poly={plan.floor_polygon} stroke={stroke} />

        {/* Коридор — заливка внутреннего пространства */}
        {plan.corridors.map((c, i) => (
          <path
            key={`cor-${i}`}
            d={polyPath(c.polygon)}
            fill="rgba(255,255,255,0.025)"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={stroke * 1.4}
          />
        ))}

        {/* Ядро (ЛЛУ) с лестничным маршем */}
        <CoreShaft core={plan.core.polygon} />

        {/* Инженерные помещения первого этажа (ИТП, электрощит, мусор) */}
        {plan.engineering_rooms?.map((room, i) => {
          const rb = bbox(room.polygon);
          const cx = (rb.minx + rb.maxx) / 2;
          const cy = (rb.miny + rb.maxy) / 2;
          const fill = ENG_COLORS[room.kind];
          return (
            <g key={`eng-${i}`}>
              <path
                d={polyPath(room.polygon)}
                fill={fill}
                fillOpacity={0.18}
                stroke={fill}
                strokeWidth={stroke * 1.2}
                strokeDasharray={`${stroke * 4} ${stroke * 2}`}
              />
              {showLabels && (
                <text
                  x={cx}
                  y={-cy}
                  fontSize={Math.min(rb.w, rb.h) * 0.32}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={fill}
                  fontWeight={600}
                  style={{ pointerEvents: "none" }}
                >
                  {room.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Квартиры */}
        {plan.tiles.map((t, i) => (
          <Apartment
            key={`apt-${t.apt_number || i}`}
            tile={t}
            color={aptColor(i)}
            stroke={stroke}
            showLabels={showLabels}
            showZones={showZones}
            showFixtures={showFixtures && !compact}
          />
        ))}

        {/* Северная стрелка */}
        {showScale && (
          <g transform={`translate(${b.minx + b.w - 3}, ${-(b.miny + b.h) + 2.5})`}>
            <circle r="1.4" fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.4)" strokeWidth="0.06" />
            <path d="M 0 -0.9 L 0.4 0.5 L 0 0.2 L -0.4 0.5 Z" fill="#0a0a0c" />
            <text x="0" y="-1.7" textAnchor="middle" fontSize="0.95" fill="rgba(0,0,0,0.85)" fontWeight={700}>N</text>
          </g>
        )}

        {/* Масштабная линейка */}
        {showScale && (
          <g transform={`translate(${b.minx + 1}, ${-(b.miny) - 0.2})`}>
            <rect width="10" height="0.35" fill="#fff" stroke="#000" strokeWidth="0.04" />
            <rect x="2" width="2" height="0.35" fill="#000" />
            <rect x="6" width="2" height="0.35" fill="#000" />
            <text y="-0.3" fontSize="0.85" fill="rgba(255,255,255,0.55)" fontFamily="var(--font-geist-mono), monospace">0          10 м</text>
          </g>
        )}
      </svg>

      {variantBadge && (
        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-medium tracking-wider uppercase surface text-white/70">
          {variantBadge}
        </div>
      )}
    </div>
  );
}

// ---- Exterior bearing wall ------------------------------------------------

function ExteriorWall({ poly, stroke }: { poly: Polygon; stroke: number }) {
  // имитация СНиП-стиля: внешняя стенка красной штриховкой огнестойкости.
  // Для прямоугольного контура — рисуем "ленту" полигоном (внешний прямоугольник
  // минус внутренний). Внутренний — отступ 0.4 м внутрь.
  const t = 0.4;
  const b = bbox(poly);
  const outer = polyPath(poly);
  // inner — уменьшенный прямоугольник (упрощение для прямоугольного контура)
  const inner = `M ${b.minx + t} ${-(b.miny + t)} L ${b.maxx - t} ${-(b.miny + t)} L ${b.maxx - t} ${-(b.maxy - t)} L ${b.minx + t} ${-(b.maxy - t)} Z`;
  return (
    <>
      {/* лента стены — fill-rule evenodd */}
      <path
        d={`${outer} ${inner}`}
        fill="url(#bearing-wall)"
        fillRule="evenodd"
        stroke="rgba(120,30,30,0.7)"
        strokeWidth={stroke}
      />
      {/* пол этажа — лёгкая заливка */}
      <path d={inner} fill="rgba(0,0,0,0.0)" />
    </>
  );
}

// ---- Core (ЛЛУ) -----------------------------------------------------------

function CoreShaft({ core }: { core: Polygon }) {
  const b = bbox(core);
  // лестничный марш — две полосы treadов
  const stairW = b.w * 0.45;
  const stairH = b.h * 0.78;
  const stairX = b.minx + (b.w - stairW) / 2;
  const stairY = b.miny + (b.h - stairH) / 2;
  const treads = 12;
  const dy = stairH / treads;

  return (
    <g>
      {/* фон ядра (стены) */}
      <path
        d={polyPath(core)}
        fill="#1a1a22"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.18"
      />
      {/* шахта лифта — слева в ядре, узкий прямоугольник */}
      <rect
        x={b.minx + 0.4}
        y={-(b.maxy - 0.4)}
        width={b.w * 0.18}
        height={b.h - 0.8}
        fill="url(#core-hatch)"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.1"
      />
      {/* лестничный марш — ступени */}
      <rect
        x={stairX}
        y={-(stairY + stairH)}
        width={stairW}
        height={stairH}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.1"
      />
      {/* ступени */}
      {Array.from({ length: treads - 1 }, (_, i) => i + 1).map((i) => (
        <line
          key={i}
          x1={stairX}
          y1={-(stairY + i * dy)}
          x2={stairX + stairW}
          y2={-(stairY + i * dy)}
          stroke="rgba(255,255,255,0.22)"
          strokeWidth="0.05"
        />
      ))}
      {/* стрелка вверх — направление подъёма */}
      <path
        d={`M ${stairX + stairW / 2} ${-(stairY + 0.4)} L ${stairX + stairW / 2} ${-(stairY + stairH - 0.4)} M ${stairX + stairW / 2 - 0.5} ${-(stairY + stairH - 0.9)} L ${stairX + stairW / 2} ${-(stairY + stairH - 0.4)} L ${stairX + stairW / 2 + 0.5} ${-(stairY + stairH - 0.9)}`}
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="0.08"
        fill="none"
      />
      {/* подпись «ЛЛУ» */}
      <text
        x={b.minx + b.w / 2}
        y={-(b.miny + 0.7)}
        textAnchor="middle"
        fontSize="0.9"
        fill="rgba(255,255,255,0.5)"
        fontWeight={600}
        letterSpacing="0.1em"
      >
        ЛЛУ
      </text>
    </g>
  );
}

// ---- Apartment tile -------------------------------------------------------

function Apartment({
  tile,
  color,
  stroke,
  showLabels,
  showZones,
  showFixtures,
}: {
  tile: PlacedTile;
  color: string;
  stroke: number;
  showLabels: boolean;
  showZones: boolean;
  showFixtures: boolean;
}) {
  const tb = bbox(tile.polygon);
  // ориентация тайла: фасад снизу (y_world малый) или сверху?
  // facade_edge.a — это начало фасадного ребра. Если y фасада < центр тайла → фасад снизу.
  const facadeY = (tile.facade_edge.a.y + tile.facade_edge.b.y) / 2;
  const tileCY = tb.miny + tb.h / 2;
  const facadeBelow = facadeY < tileCY;
  // сторона коридора (противоположная фасаду)
  const corridorY = facadeBelow ? tb.maxy : tb.miny;

  return (
    <g>
      {/* заливка квартиры */}
      <path
        d={polyPath(tile.polygon)}
        fill={color}
        fillOpacity={0.35}
        stroke="rgba(0,0,0,0.55)"
        strokeWidth={stroke * 1.6}
      />

      {/* зоны: фон + внутренние перегородки */}
      {showZones &&
        tile.zones.map((z, zi) => (
          <ZoneShape key={`z-${zi}`} zone={z} stroke={stroke * 0.6} />
        ))}

      {/* окна на фасадной стороне */}
      <FacadeWindows tile={tile} facadeBelow={facadeBelow} />

      {/* входная дверь с дугой */}
      {tile.door_world && (
        <DoorSwing
          door={tile.door_world}
          tile={tile}
          facadeBelow={facadeBelow}
          stroke={stroke}
        />
      )}

      {/* сантехника */}
      {showFixtures &&
        tile.zones.map((z, zi) => {
          if (z.kind === "bathroom") return <BathroomFixtures key={`bf-${zi}`} zone={z} />;
          if (z.kind === "kitchen") return <KitchenFixtures key={`kf-${zi}`} zone={z} corridorY={corridorY} />;
          return null;
        })}

      {/* лоджия — узкая полоса перед фасадом */}
      <Loggia tile={tile} facadeBelow={facadeBelow} />

      {/* подпись квартиры */}
      {showLabels && tb.w > 3.5 && tb.h > 3.0 && (
        <ApartmentLabel tile={tile} />
      )}
    </g>
  );
}

// ---- Zones ----------------------------------------------------------------

function ZoneShape({ zone, stroke }: { zone: PlacedZone; stroke: number }) {
  return (
    <path
      d={polyPath(zone.polygon)}
      fill={ZONE_COLORS[zone.kind]}
      stroke="rgba(0,0,0,0.45)"
      strokeWidth={stroke}
    />
  );
}

// ---- Windows on facade ----------------------------------------------------

function FacadeWindows({ tile, facadeBelow }: { tile: PlacedTile; facadeBelow: boolean }) {
  const tb = bbox(tile.polygon);
  // окна — 2 штуки, равномерно вдоль фасада, ширина ~1.4 м, толщина 0.25 м
  const winW = Math.min(1.6, tb.w * 0.28);
  const winT = 0.25;
  const positions = [tb.minx + tb.w * 0.25 - winW / 2, tb.minx + tb.w * 0.75 - winW / 2];
  const y = facadeBelow ? tb.miny : tb.maxy - winT;

  return (
    <>
      {positions.map((x, i) => (
        <g key={i}>
          <rect
            x={x}
            y={-(y + winT)}
            width={winW}
            height={winT}
            fill="rgba(120, 200, 255, 0.4)"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="0.04"
          />
          {/* перекладина окна */}
          <line
            x1={x}
            y1={-(y + winT / 2)}
            x2={x + winW}
            y2={-(y + winT / 2)}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="0.04"
          />
        </g>
      ))}
    </>
  );
}

// ---- Door swing arc -------------------------------------------------------

function DoorSwing({
  door,
  tile,
  facadeBelow,
  stroke,
}: {
  door: Point;
  tile: PlacedTile;
  facadeBelow: boolean;
  stroke: number;
}) {
  const r = Math.min(0.85, tile.width * 0.13);
  // дверь "открывается" внутрь квартиры
  const sweepDir = facadeBelow ? 1 : -1;
  // точка на стене (door.x, door.y) → дуга к точке (door.x + r, door.y - r * sweepDir)
  const startX = door.x;
  const startY = door.y;
  const endX = door.x + r;
  // в SVG y инвертирован — вычисляем напрямую
  const arcEndY = door.y - r * sweepDir;
  // SVG: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
  return (
    <g>
      {/* «вырез» в стене для двери — короткая белая линия (поверх стены квартиры) */}
      <line
        x1={door.x - 0.05}
        y1={-door.y}
        x2={door.x + r + 0.05}
        y2={-door.y}
        stroke="rgba(0,0,0,0.0)"
        strokeWidth={stroke * 3}
      />
      {/* створка двери */}
      <line
        x1={startX}
        y1={-startY}
        x2={endX}
        y2={-arcEndY}
        stroke="rgba(0,0,0,0.7)"
        strokeWidth="0.08"
      />
      {/* дуга открытия */}
      <path
        d={`M ${endX} ${-arcEndY} A ${r} ${r} 0 0 ${facadeBelow ? 0 : 1} ${startX} ${-(startY - 0.001)}`}
        stroke="rgba(0,0,0,0.45)"
        strokeWidth="0.05"
        fill="none"
        strokeDasharray="0.18 0.12"
      />
    </g>
  );
}

// ---- Bathroom fixtures ----------------------------------------------------

function BathroomFixtures({ zone }: { zone: PlacedZone }) {
  const b = bbox(zone.polygon);
  if (b.w < 1.4 || b.h < 1.4) return null;
  // унитаз — справа, ванна/душ — слева/верх
  const tubW = Math.min(1.6, b.w * 0.85);
  const tubH = 0.7;
  const toiletW = 0.45;
  const toiletH = 0.7;

  return (
    <g>
      {/* ванна */}
      <rect
        x={b.minx + 0.15}
        y={-(b.miny + b.h - 0.15 - tubH)}
        width={tubW * 0.55}
        height={tubH}
        fill="#fff"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.04"
        rx="0.1"
      />
      {/* унитаз */}
      <rect
        x={b.minx + b.w - toiletW - 0.15}
        y={-(b.miny + b.h - 0.15 - toiletH)}
        width={toiletW}
        height={toiletH}
        fill="#fff"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.04"
        rx="0.08"
      />
      {/* раковина */}
      <rect
        x={b.minx + 0.15}
        y={-(b.miny + 0.15 + 0.4)}
        width={0.55}
        height={0.4}
        fill="#fff"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.04"
        rx="0.05"
      />
    </g>
  );
}

// ---- Kitchen fixtures -----------------------------------------------------

function KitchenFixtures({
  zone,
  corridorY,
}: {
  zone: PlacedZone;
  corridorY: number;
}) {
  const b = bbox(zone.polygon);
  if (b.w < 1.4 || b.h < 1.4) return null;
  // мойка + плита — прижимаются к стенке (у коридора, где подходят коммуникации)
  const sinkW = 0.6;
  const sinkH = 0.45;
  const stoveW = 0.6;
  const stoveH = 0.55;
  const isCorrAbove = corridorY > b.miny + b.h / 2;
  const counterY = isCorrAbove ? b.miny + b.h - sinkH - 0.1 : b.miny + 0.1;

  return (
    <g>
      <rect
        x={b.minx + 0.2}
        y={-(counterY + sinkH)}
        width={sinkW}
        height={sinkH}
        fill="#fff"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.04"
        rx="0.05"
      />
      <circle
        cx={b.minx + 0.2 + sinkW / 2}
        cy={-(counterY + sinkH / 2)}
        r="0.13"
        fill="none"
        stroke="rgba(0,0,0,0.4)"
        strokeWidth="0.04"
      />
      <rect
        x={b.minx + 1.0}
        y={-(counterY + stoveH)}
        width={stoveW}
        height={stoveH}
        fill="#fff"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.04"
      />
      {/* конфорки */}
      {[0.2, 0.4].map((dx, i) =>
        [0.15, 0.4].map((dy, j) => (
          <circle
            key={`${i}-${j}`}
            cx={b.minx + 1.0 + dx}
            cy={-(counterY + stoveH - dy)}
            r="0.08"
            fill="rgba(0,0,0,0.25)"
          />
        )),
      )}
    </g>
  );
}

// ---- Loggia ---------------------------------------------------------------

function Loggia({ tile, facadeBelow }: { tile: PlacedTile; facadeBelow: boolean }) {
  const tb = bbox(tile.polygon);
  const w = tb.w * 0.6;
  const h = 1.0;
  const x = tb.minx + (tb.w - w) / 2;
  const y = facadeBelow ? tb.miny - h : tb.maxy;
  return (
    <rect
      x={x}
      y={-(y + h)}
      width={w}
      height={h}
      fill="rgba(167,139,250,0.06)"
      stroke="rgba(255,255,255,0.18)"
      strokeWidth="0.08"
      strokeDasharray="0.3 0.2"
    />
  );
}

// ---- Apartment label ------------------------------------------------------

function ApartmentLabel({ tile }: { tile: PlacedTile }) {
  const tb = bbox(tile.polygon);
  // помещаем подпись в центр живой зоны (биггест living или bedroom)
  const livingZones = tile.zones.filter(
    (z) => z.kind === "living" || z.kind === "bedroom",
  );
  let labelBox = tb;
  if (livingZones.length) {
    const big = livingZones.reduce((a, b) =>
      bbox(a.polygon).w * bbox(a.polygon).h >
      bbox(b.polygon).w * bbox(b.polygon).h
        ? a
        : b,
    );
    labelBox = bbox(big.polygon);
  }
  const cx = labelBox.minx + labelBox.w / 2;
  const cy = labelBox.miny + labelBox.h / 2;

  const sObsh = tile.area.toFixed(2);
  const sLiving = tile.living_area.toFixed(2);
  const fs = Math.min(labelBox.w * 0.16, labelBox.h * 0.18, 1.4);

  return (
    <g>
      <text
        x={cx}
        y={-(cy + fs * 1.1)}
        textAnchor="middle"
        fontSize={fs * 1.05}
        fontWeight={700}
        fill="rgba(0,0,0,0.85)"
        fontFamily="var(--font-geist-sans), sans-serif"
      >
        КВ №{tile.apt_number}
      </text>
      <text
        x={cx}
        y={-(cy)}
        textAnchor="middle"
        fontSize={fs * 0.7}
        fill="rgba(0,0,0,0.7)"
        fontFamily="var(--font-geist-mono), monospace"
      >
        S общ. {sObsh} м²
      </text>
      {tile.living_area > 0 && (
        <text
          x={cx}
          y={-(cy - fs * 0.95)}
          textAnchor="middle"
          fontSize={fs * 0.7}
          fill="rgba(0,0,0,0.7)"
          fontFamily="var(--font-geist-mono), monospace"
        >
          S жил. {sLiving} м²
        </text>
      )}
    </g>
  );
}
