/**
 * Ring motion for the concordance rings — docs/CONCORDANCE-RINGS.md, "Motion:
 * sorting and aligning".
 *
 * Rings move two ways, and the two are independent so they can run at once:
 *
 *   TRAVEL (sort)  radius and thickness change — order, view or roots changed.
 *   TURN (align)   rotation changes — each ring brings an anchor ayah to 12.
 *
 * Every ring holds its own tracks; `sample(t)` evaluates them. Time comes only
 * from the `t` passed in (requestAnimationFrame timestamps in the app), never
 * from a clock read here, so a test or a recording can step the motion frame
 * by frame. A new request mid-motion starts from wherever each ring is at that
 * instant; nothing snaps.
 */

export interface RingPose {
  r: number;
  half: number;
  rot: number;
  alpha: number;
}

interface Track {
  from: number;
  to: number;
  start: number;
  dur: number;
}

interface RingTracks {
  r: Track;
  half: Track;
  alpha: Track;
  rot: Track;
}

export type TurnStyle = "expressive" | "calm" | "instant";

/** Spec timings. */
export const TRAVEL_MS = 700;
export const TRAVEL_STAGGER_MS = 220;
export const CALM_TURN_MS = 600;
export const CALM_STAGGER_MS = 8;
export const EXPRESSIVE_BASE_MS = 1100;
export const EXPRESSIVE_PER_TURN_MS = 380;
export const EXPRESSIVE_STAGGER_MS = 22;
/** A ring that is travelling draws at about this opacity, so crossings stay legible. */
export const TRAVEL_ALPHA = 0.6;

const TAU = Math.PI * 2;

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function evalTrack(tr: Track, t: number): number {
  if (tr.dur <= 0 || t >= tr.start + tr.dur) return tr.to;
  if (t <= tr.start) return tr.from;
  return tr.from + (tr.to - tr.from) * easeInOutCubic((t - tr.start) / tr.dur);
}

function still(v: number): Track {
  return { from: v, to: v, start: 0, dur: 0 };
}

/** Wrap to (-π, π]. */
function wrap(a: number): number {
  const w = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return w === -Math.PI ? Math.PI : w;
}

export interface TravelTarget {
  r: number;
  half: number;
  alpha: number;
}

export class RingMotion {
  private rings = new Map<number, RingTracks>();

  /** Current pose of one ring at time t. */
  pose(n: number, t: number): RingPose | null {
    const tr = this.rings.get(n);
    if (!tr) return null;
    return {
      r: evalTrack(tr.r, t),
      half: evalTrack(tr.half, t),
      rot: evalTrack(tr.rot, t),
      alpha: evalTrack(tr.alpha, t),
    };
  }

  /**
   * Every ring's pose at time t, with a travelling ring's opacity lowered so
   * rings passing through each other stay readable.
   */
  sample(t: number): Map<number, RingPose> {
    const out = new Map<number, RingPose>();
    for (const [n, tr] of this.rings) {
      const moving = t < tr.r.start + tr.r.dur && Math.abs(tr.r.to - tr.r.from) > 0.5;
      const alpha = evalTrack(tr.alpha, t) * (moving ? TRAVEL_ALPHA : 1);
      out.set(n, { r: evalTrack(tr.r, t), half: evalTrack(tr.half, t), rot: evalTrack(tr.rot, t), alpha });
    }
    return out;
  }

  /** True while any ring's radius or thickness is still changing. */
  travelling(t: number): boolean {
    for (const tr of this.rings.values()) {
      if (t < tr.r.start + tr.r.dur && tr.r.to !== tr.r.from) return true;
      if (t < tr.half.start + tr.half.dur && tr.half.to !== tr.half.from) return true;
    }
    return false;
  }

  /** True while any ring is still turning. */
  turning(t: number): boolean {
    for (const tr of this.rings.values()) if (t < tr.rot.start + tr.rot.dur && tr.rot.to !== tr.rot.from) return true;
    return false;
  }

  /** When the last track ends. */
  endsAt(): number {
    let end = 0;
    for (const tr of this.rings.values())
      for (const k of [tr.r, tr.half, tr.alpha, tr.rot]) end = Math.max(end, k.start + k.dur);
    return end;
  }

  /**
   * Send rings to new radii and thicknesses.
   *
   * A ring that leaves (target half 0) collapses where it stands; a ring that
   * arrives from nothing appears at its new radius and grows from zero. Starts
   * are staggered by how far a ring travels, short trips first, so the rings
   * that clear the way move before the ones crossing the whole field.
   * `instant` jumps straight to the end state (first paint, reduced motion).
   */
  travelTo(targets: Map<number, TravelTarget>, t: number, instant = false): void {
    let maxTrip = 1;
    const trips = new Map<number, number>();
    for (const [n, target] of targets) {
      const now = this.pose(n, t);
      const trip = now && Number.isFinite(target.r) && now.half > 0.05 ? Math.abs(target.r - now.r) : 0;
      trips.set(n, trip);
      maxTrip = Math.max(maxTrip, trip);
    }

    for (const [n, target] of targets) {
      const now = this.pose(n, t);
      const tr = this.rings.get(n);
      const rotTrack = tr ? tr.rot : still(0);

      if (instant || !now) {
        const r = Number.isFinite(target.r) ? target.r : now?.r ?? 0;
        this.rings.set(n, { r: still(r), half: still(target.half), alpha: still(target.alpha), rot: rotTrack });
        continue;
      }

      const delay = (trips.get(n)! / maxTrip) * TRAVEL_STAGGER_MS;
      const start = t + delay;
      const arriving = now.half <= 0.05 && target.half > 0;
      const leaving = target.half <= 0;
      // Leaving: stay put and shrink. Arriving: jump to the new radius while
      // still invisible, then grow. Otherwise: travel.
      const toR = leaving || !Number.isFinite(target.r) ? now.r : target.r;
      const fromR = arriving ? toR : now.r;

      this.rings.set(n, {
        r: { from: fromR, to: toR, start, dur: TRAVEL_MS },
        half: { from: now.half, to: target.half, start, dur: TRAVEL_MS },
        alpha: { from: now.alpha, to: target.alpha, start, dur: TRAVEL_MS },
        rot: rotTrack,
      });
    }
  }

  /**
   * Turn rings to target rotations.
   *
   * `order` is innermost first, and sets each ring's index k:
   *   expressive  alternate direction by k (innermost anticlockwise), 1–3
   *               extra full turns cycling with k, 22 ms stagger, 1,100 ms
   *               plus 380 ms per extra turn — 39 rings settle in ≈3.1 s.
   *   calm        shortest turn, no extra turns, 600 ms, 8 ms stagger —
   *               all 114 in ≈1.5 s.
   *   instant     jump (reduced motion).
   * Rings missing from `targets` turn back to 0.
   */
  turnTo(targets: Map<number, number>, order: number[], t: number, style: TurnStyle): void {
    const index = new Map(order.map((n, k) => [n, k]));
    for (const [n, tr] of this.rings) {
      const now = evalTrack(tr.rot, t);
      const target = targets.get(n) ?? 0;
      if (style === "instant") {
        tr.rot = still(wrap(target));
        continue;
      }
      const k = index.get(n) ?? 0;
      let delta = wrap(target - now);
      let dur = CALM_TURN_MS;
      let delay = CALM_STAGGER_MS * k;

      if (style === "expressive") {
        // Screen angles grow clockwise, so anticlockwise is negative.
        const dir = k % 2 === 0 ? -1 : 1;
        const extra = 1 + (k % 3);
        if (dir < 0 && delta > 0) delta -= TAU;
        if (dir > 0 && delta < 0) delta += TAU;
        delta += dir * extra * TAU;
        dur = EXPRESSIVE_BASE_MS + EXPRESSIVE_PER_TURN_MS * extra;
        delay = EXPRESSIVE_STAGGER_MS * k;
      }
      tr.rot = { from: now, to: now + delta, start: t + delay, dur };
    }
  }

  /**
   * Fold finished rotations back into (-π, π], so the next turn measures its
   * shortest path from a sane angle. Call once motion is over.
   */
  settle(t: number): void {
    for (const tr of this.rings.values()) {
      if (t >= tr.rot.start + tr.rot.dur) tr.rot = still(wrap(tr.rot.to));
    }
  }
}
