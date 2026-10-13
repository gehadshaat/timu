import { describe, expect, it } from "vitest";
import { DESK_W, MAP_W, layoutOffice, nearestSeat, roomCols, stepToward } from "./office-map";

const room = (id: string, ...teams: number[]) => ({
  id,
  teams: teams.map((n, t) => ({ id: `${id}-t${t}`, members: Array.from({ length: n }, (_, i) => ({ id: `${id}-t${t}-m${i}` })) })),
});

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("office map layout", () => {
  it("sizes rooms by their biggest team, between 2 and 4 desks wide", () => {
    expect(roomCols(room("a", 1))).toBe(2);
    expect(roomCols(room("b", 3, 1))).toBe(3);
    expect(roomCols(room("c", 9))).toBe(4);
  });

  it("gives every teammate a seat inside their room, and rooms never overlap", () => {
    const rooms = [room("a", 7), room("b", 2, 2), room("c", 13, 4), room("d", 1), room("e", 5), room("f", 3)];
    const map = layoutOffice(rooms);
    expect(map.seats).toHaveLength(7 + 4 + 17 + 1 + 5 + 3);
    for (const s of map.seats) {
      const r = map.rooms.find((x) => x.id === s.roomId)!;
      expect(s.x).toBeGreaterThanOrEqual(r.x);
      expect(s.x + DESK_W).toBeLessThanOrEqual(r.x + r.w);
      expect(s.y).toBeGreaterThanOrEqual(r.y);
      expect(s.y).toBeLessThan(r.y + r.h);
    }
    const boxes = [map.lobby, ...map.rooms];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    for (const r of map.rooms) expect(r.x + r.w).toBeLessThanOrEqual(MAP_W);
    expect(map.height).toBeGreaterThan(Math.max(...map.rooms.map((r) => r.y + r.h)));
  });

  it("finds the teammate you're standing next to, and nobody when you're far away", () => {
    const map = layoutOffice([room("a", 2)]);
    const s = map.seats[1];
    expect(nearestSeat(map.seats, s.spotX + 10, s.spotY)?.memberId).toBe(s.memberId);
    expect(nearestSeat(map.seats, s.spotX + 500, s.spotY + 500)).toBeNull();
  });

  it("walks toward a point without overshooting", () => {
    expect(stepToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toEqual({ x: 4, y: 0, arrived: false });
    expect(stepToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 10)).toEqual({ x: 3, y: 4, arrived: true });
  });
});
