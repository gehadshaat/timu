import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { avatarUrl, POSES } from "@/lib/avatar";
import { PROP_KINDS } from "@/lib/classify/schema";
import type { AvatarSpec } from "@/lib/types";
import { Character, CharacterSvg } from "./Character";
import { CHARACTER_CSS } from "./character-css";
import { avatarFromQuery, avatarSvg, svgMarkup } from "./character-svg";

const SPECS: AvatarSpec[] = [
  { seed: "Maya:SEO" },
  { seed: "Leo:Dev", prop: "laptop", glasses: true },
  { seed: "Iris:Design", prop: "palette", skin: 4, hair: 7, hairColor: 2, outfit: 8, glasses: false },
  { seed: "Kai & Nora <ops>", prop: "headset" },
  ...PROP_KINDS.map((prop, i) => ({ seed: `Pip-${i}`, prop })),
];

describe("small avatars drawn as images", () => {
  it("draws exactly what React would, for every pose, prop and stance", () => {
    for (const spec of SPECS) {
      for (const pose of POSES) {
        for (const extra of [{ desk: false }, { desk: true }, { stance: "standing" as const, carry: "mug" as const }, { absent: true }, { desk: false, title: "Maya, SEO" }]) {
          const el = createElement(CharacterSvg, { spec, pose, size: 40, ...extra });
          expect(svgMarkup(el)).toBe(renderToStaticMarkup(el));
        }
      }
    }
  });

  it("is a standalone SVG with the animations", () => {
    const svg = avatarSvg({ seed: "Maya:SEO" }, "needs_you");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`<style>${CHARACTER_CSS}</style>`);
    expect(svg).toContain('class="character pose-needs_you"');
  });

  it("round-trips the URL, and refuses anything that isn't an avatar", () => {
    for (const spec of SPECS) {
      const q = new URL(avatarUrl(spec, "working"), "http://timu").searchParams;
      expect(avatarFromQuery(q)).toEqual({ spec, pose: "working" });
    }
    const bad = ["pose=dancing&seed=x", "pose=idle", "pose=idle&seed=x&prop=sword", "pose=idle&seed=x&skin=99", "pose=idle&seed=x&hair=-1", "pose=idle&seed=x&outfit=1.5"];
    for (const q of bad) expect(avatarFromQuery(new URLSearchParams(q))).toBeNull();
  });

  it("uses an image only for small desk-less seated avatars", () => {
    const img = renderToStaticMarkup(createElement(Character, { spec: { seed: "Maya:SEO" }, pose: "idle", desk: false, size: 28 }));
    expect(img).toMatch(/^<img src="\/api\/avatar\?pose=idle&amp;seed=Maya%3ASEO"/);
    for (const props of [{ size: 28 }, { size: 92, desk: false }, { size: 40, desk: false, stance: "standing" as const }]) {
      expect(renderToStaticMarkup(createElement(Character, { spec: { seed: "Maya:SEO" }, pose: "idle", ...props }))).toMatch(/^<svg/);
    }
  });

  it("keeps the image's animation rules the same as the page's", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").split("\n").map((l) => l.trim());
    const ours = CHARACTER_CSS.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of ours) expect(page).toContain(line);
    for (const line of page.filter((l) => l.startsWith(".character"))) expect(ours).toContain(line);
  });
});
