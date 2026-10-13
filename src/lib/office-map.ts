/**
 * The office as one map, Gather style: every project is a room on a shared floor and every
 * teammate sits at a desk inside it. This works out where things go; OfficeMap draws them.
 */

export const DESK_W = 124;
export const DESK_H = 128;
export const ROOM_PAD = 26;
export const SIGN_H = 46;
export const TEAM_LABEL_H = 24;
export const MAX_COLS = 4;
export const GAP = 64;
export const MAP_PAD = 40;
export const MAP_W = 1560;

export interface LayoutRoomIn {
  id: string;
  teams: { id: string; members: { id: string }[] }[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutRoom extends Rect {
  id: string;
  teams: { id: string; y: number }[];
}

export interface Seat {
  memberId: string;
  roomId: string;
  /** Top-left of the desk cell. */
  x: number;
  y: number;
  /** Where you stand to talk to them: just below their desk. */
  spotX: number;
  spotY: number;
}

export interface OfficeLayout {
  width: number;
  height: number;
  lobby: Rect;
  rooms: LayoutRoom[];
  seats: Seat[];
}

/** How many desks wide a room is: enough for its biggest team, between 2 and MAX_COLS. */
export function roomCols(room: LayoutRoomIn): number {
  return Math.max(2, Math.min(MAX_COLS, Math.max(0, ...room.teams.map((t) => t.members.length))));
}

function roomSize(room: LayoutRoomIn): { w: number; h: number } {
  const cols = roomCols(room);
  const body = room.teams.reduce((h, t) => h + TEAM_LABEL_H + Math.max(1, Math.ceil(t.members.length / cols)) * DESK_H, 0);
  return { w: ROOM_PAD * 2 + cols * DESK_W, h: SIGN_H + body + ROOM_PAD };
}

/**
 * Shelf-pack the rooms left to right, wrapping into new rows, after a lobby with your desk.
 * Rooms keep the order given (callers sort them so a company's projects sit together).
 */
export function layoutOffice(rooms: LayoutRoomIn[], maxWidth = MAP_W): OfficeLayout {
  const lobby: Rect = { x: MAP_PAD, y: MAP_PAD, w: ROOM_PAD * 2 + 2 * DESK_W, h: SIGN_H + DESK_H + ROOM_PAD };
  let x = lobby.x + lobby.w + GAP;
  let y = MAP_PAD;
  let rowH = lobby.h;
  let width = x;
  const placed: LayoutRoom[] = [];
  const seats: Seat[] = [];

  for (const room of rooms) {
    const { w, h } = roomSize(room);
    if (x + w > maxWidth - MAP_PAD && x > MAP_PAD) {
      x = MAP_PAD;
      y += rowH + GAP;
      rowH = 0;
    }
    const cols = roomCols(room);
    const teams: LayoutRoom["teams"] = [];
    let ty = y + SIGN_H;
    for (const t of room.teams) {
      teams.push({ id: t.id, y: ty });
      const top = ty + TEAM_LABEL_H;
      t.members.forEach((m, i) => {
        const sx = x + ROOM_PAD + (i % cols) * DESK_W;
        const sy = top + Math.floor(i / cols) * DESK_H;
        seats.push({ memberId: m.id, roomId: room.id, x: sx, y: sy, spotX: sx + DESK_W / 2, spotY: sy + DESK_H - 8 });
      });
      ty = top + Math.max(1, Math.ceil(t.members.length / cols)) * DESK_H;
    }
    placed.push({ id: room.id, x, y, w, h, teams });
    x += w + GAP;
    width = Math.max(width, x - GAP);
    rowH = Math.max(rowH, h);
  }

  return { width: width + MAP_PAD, height: y + rowH + MAP_PAD, lobby, rooms: placed, seats };
}

/** The seat nearest to a point, if it's within `reach`. */
export function nearestSeat(seats: Seat[], x: number, y: number, reach = 90): Seat | null {
  let best: Seat | null = null;
  let bestD = reach * reach;
  for (const s of seats) {
    const d = (s.spotX - x) ** 2 + (s.spotY - y) ** 2;
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** One step from `from` toward `to`, at most `dist` long; returns the new point and whether it arrived. */
export function stepToward(from: { x: number; y: number }, to: { x: number; y: number }, dist: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len <= dist) return { x: to.x, y: to.y, arrived: true };
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist, arrived: false };
}
