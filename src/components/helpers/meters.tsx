import { achievementBand } from "./reason-labels";

/**
 * The one glyph this product is built on. A rail from 0% to 150% of target with
 * a hard notch at 100%: the question a media buyer actually asks is not "what
 * is the number" but "am I past the line", and that reads faster as a picture.
 */
export function NotchMeter({
  value,
  size = "row"
}: { value: number | null | undefined; size?: "row" | "lead" }) {
  const band = achievementBand(value);
  const width = Math.min(100, Math.max(0, ((value ?? 0) / 1.5) * 100));
  return (
    <span className={`notchMeter ${size}`} aria-hidden="true">
      <i className={`band-${band}`} style={{ width: `${width}%` }} />
      <u />
    </span>
  );
}

export type TrailWindow = {
  id: string;
  label: string;
  achievement: number | null;
  includeInScore: boolean;
};

/**
 * Three ticks — today, three days, seven days — so a row shows its direction,
 * not just its verdict. A decaying ad and a recovering ad can share a score.
 */
export function WindowTrail({ windows }: { windows: TrailWindow[] }) {
  if (!windows.length) return null;
  return (
    <span className="windowTrail" aria-hidden="true">
      {windows.map((window) => {
        const band = achievementBand(window.achievement);
        const height = window.achievement === null
          ? 14
          : Math.min(100, Math.max(14, (window.achievement / 1.5) * 100));
        return (
          <b
            key={window.id}
            className={`band-${band}${window.includeInScore ? "" : " faded"}`}
            style={{ height: `${height}%` }}
            title={window.label}
          />
        );
      })}
    </span>
  );
}
