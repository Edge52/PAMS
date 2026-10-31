/** Static (server-rendered) floor-plan crop that highlights one room and one asset pin. Same pin layout as the floor map. */
import Link from "next/link";
import { fitRect } from "@/lib/assets/geometry";
import { layoutPins } from "@/lib/assets/pins";
import { fitLabel, pinStyle, shapePath } from "@/lib/assets/visuals";
import type { miniMapData } from "@/lib/assets/queries";

type Data = NonNullable<Awaited<ReturnType<typeof miniMapData>>>;

export function MiniMap({ data, roomId, assetId, categoryCode }: { data: Data; roomId: number; assetId: number; categoryCode: string | null }) {
  const room = data.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const { pos } = layoutPins(data.rooms, data.assets.map((a) => ({ id: a.id, roomId: a.roomId, posX: a.posX, posY: a.posY, sortKey: `${a.typeCode} ${a.tag}` })));
  const vb = fitRect(room, 16 / 9, 1.1);
  const me = pos.get(assetId);
  const style = pinStyle(categoryCode);
  return (
    <Link href={`/assets/map?assetId=${assetId}`} className="group block overflow-hidden rounded-[var(--radius-control)] border border-line bg-sunken" aria-label="Open on the floor map">
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="block aspect-video w-full" role="img" aria-label={`${room.name} on the floor plan`}>
        <rect x={0} y={0} width={data.floor.planWidth} height={data.floor.planHeight} style={{ fill: "var(--color-surface)" }} />
        {data.floor.planImageUrl && (
          <image href={data.floor.planImageUrl} x={0} y={0} width={data.floor.planWidth} height={data.floor.planHeight} opacity={0.6} preserveAspectRatio="xMidYMid meet" />
        )}
        {data.rooms.map((r) => {
          const fs = Math.min(9, r.h * 0.14);
          return (
            <g key={r.id}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={2}
                style={{ fill: r.id === roomId ? "var(--color-tag-soft)" : r.type === "CORRIDOR" ? "var(--color-sunken)" : "var(--color-canvas)", stroke: r.id === roomId ? "var(--color-tag)" : "var(--color-line)" }}
                strokeWidth={r.id === roomId ? 2.5 : 1} vectorEffect="non-scaling-stroke" />
              <text x={r.x + 3} y={r.y + fs + 2} fontSize={fs} fontWeight={r.id === roomId ? 700 : 400} style={{ fill: r.id === roomId ? "var(--color-ink)" : "var(--color-faint)" }}>{fitLabel(r.name, r.w, fs)}</text>
            </g>
          );
        })}
        {data.assets.map((a) => {
          const p = pos.get(a.id);
          if (!p || a.id === assetId) return null;
          return <circle key={a.id} cx={p.x} cy={p.y} r={p.r * 0.55} style={{ fill: "var(--color-faint)" }} opacity={a.roomId === roomId ? 0.8 : 0.35} />;
        })}
        {me && (
          <g transform={`translate(${me.x} ${me.y})`}>
            <circle r={me.r + 5} style={{ fill: "var(--color-tag)" }} opacity={0.25} />
            <circle r={me.r + 1.8} style={{ fill: "var(--color-surface)", stroke: "var(--color-ink)" }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <path d={shapePath(style.shape, me.r)} style={{ fill: "var(--color-tag)" }} />
            <text y={me.r * 0.4} textAnchor="middle" fontSize={me.r * (style.glyph.length > 1 ? 0.85 : 1.15)} fontWeight={700} style={{ fill: "var(--color-ink)" }}>{style.glyph}</text>
          </g>
        )}
      </svg>
      <span className="block border-t border-line bg-surface px-3 py-1.5 text-sm font-semibold text-primary group-hover:underline">Open on the floor map ›</span>
    </Link>
  );
}
