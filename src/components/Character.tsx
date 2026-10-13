import type { AvatarSpec, PropKind } from "@/lib/types";
import { traitsFor, type Pose, type Traits } from "@/lib/avatar";

/**
 * Parametric cartoon team member.
 * Seated (default): viewBox 160×160, head centred at (80,64) r=29, desk top at y=128.
 * Standing: same head/torso coordinates plus legs, viewBox 160×196 — used for the queue
 * at your desk and for teammates wandering the office.
 * Animations are CSS classes defined in globals.css.
 */
export function Character({
  spec,
  pose,
  size = 160,
  desk = true,
  stance = "seated",
  carry,
  absent = false,
  title,
}: {
  spec: AvatarSpec;
  pose: Pose;
  size?: number;
  desk?: boolean;
  stance?: "seated" | "standing";
  /** Something held while standing, e.g. a coffee on the way back from the kitchen. */
  carry?: "mug" | "paper";
  /** Draw only the empty desk and chair (the teammate has stepped away). */
  absent?: boolean;
  title?: string;
}) {
  const t = traitsFor(spec);
  const ink = "#2a2118";
  const standing = stance === "standing";
  const seatedDesk = desk && !standing;
  const tilt = pose === "idle" ? "rotate(9 80 96)" : pose === "failed" ? "rotate(-3 80 96)" : pose === "thinking" ? "rotate(-5 80 96)" : undefined;
  const viewBox = standing ? "0 8 160 190" : seatedDesk ? "0 0 160 160" : "8 10 144 122";
  const [, , vw, vh] = viewBox.split(" ").map(Number);
  const bob = pose === "needs_you" || pose === "done" || (standing && pose === "walking");

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={(size * vh) / vw}
      role="img"
      aria-label={title ?? "Team member"}
      className={`character pose-${pose}`}
    >
      {title ? <title>{title}</title> : null}
      {seatedDesk ? (
        <g>
          {/* chair */}
          <rect x="46" y="88" width="68" height="60" rx="14" fill="#3f3a52" />
          <rect x="52" y="94" width="56" height="50" rx="10" fill="#57506f" />
        </g>
      ) : null}

      {standing ? <Legs walking={pose === "walking"} /> : null}

      {absent ? null : <g className={bob ? "bob" : undefined}>
        {/* back hair sits behind the body so long hair doesn't cover arms */}
        <g transform={tilt}>
          <HairBack style={t.hair} color={t.hairColor} />
        </g>
        {/* torso */}
        <path d="M46 152 C46 118 60 103 80 103 C100 103 114 118 114 152 Z" fill={t.outfit} />
        <path d="M70 104 L80 118 L90 104" fill="none" stroke="#ffffff" strokeOpacity=".55" strokeWidth="3" strokeLinejoin="round" />
        {/* neck */}
        <rect x="73" y="88" width="14" height="18" rx="5" fill={t.skin} />
        <rect x="73" y="98" width="14" height="5" fill="#000" opacity=".08" />
        {t.prop === "stethoscope" ? <Stethoscope /> : null}

        <g transform={tilt}>
          <Head t={t} pose={pose} ink={ink} />
        </g>

        {standing ? (
          <StandingArms t={t} pose={pose} carry={carry} />
        ) : seatedDesk || GESTURES.has(pose) ? (
          /* Without a desk only gestures read well; resting hands would float over the torso. */
          <Arms t={t} pose={pose} />
        ) : null}
      </g>}

      {seatedDesk ? <Desk t={t} pose={absent ? "idle" : pose} /> : null}
      {absent ? null : <Overlay pose={pose} />}
    </svg>
  );
}

const GESTURES = new Set<Pose>(["needs_you", "done", "review", "thinking", "call"]);

function Head({ t, pose, ink }: { t: Traits; pose: Pose; ink: string }) {
  return (
    <g>
      {/* ears */}
      <circle cx="51" cy="67" r="6.5" fill={t.skin} />
      <circle cx="109" cy="67" r="6.5" fill={t.skin} />
      <circle cx="51" cy="67" r="3" fill="#000" opacity=".08" />
      <circle cx="109" cy="67" r="3" fill="#000" opacity=".08" />
      {/* face: slightly squashed big caricature head */}
      <ellipse cx="80" cy="64" rx="29.5" ry="30.5" fill={t.skin} />
      <ellipse cx="80" cy="80" rx="22" ry="12" fill="#000" opacity=".04" />
      <Face t={t} pose={pose} ink={ink} />
      <HairFront style={t.hair} color={t.hairColor} />
      {t.prop === "headset" ? <Headset /> : null}
    </g>
  );
}

function Face({ t, pose, ink }: { t: Traits; pose: Pose; ink: string }) {
  const happy = pose === "done";
  const asleep = pose === "idle";
  const worried = pose === "failed";
  const eager = pose === "needs_you" || pose === "review";
  // Where the pupils look: down at a book, up while thinking.
  const gy = pose === "reading" ? 2.5 : pose === "thinking" ? -2 : 0;
  const gx = pose === "thinking" ? 1.5 : 0;

  return (
    <g>
      {/* brows */}
      {worried ? (
        <>
          <path d="M64 52 L74 49" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M96 52 L86 49" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d={eager ? "M63 50 Q69 45 75 49" : "M64 52 Q69 49 75 51"} fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
          <path d={eager ? "M85 49 Q91 45 97 50" : "M85 51 Q91 49 96 52"} fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
        </>
      )}

      {/* eyes */}
      {asleep ? (
        <>
          <path d="M64 62 Q69 66 74 62" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
          <path d="M86 62 Q91 66 96 62" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
        </>
      ) : happy ? (
        <>
          <path d="M64 63 Q69 57 74 63" fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" />
          <path d="M86 63 Q91 57 96 63" fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" />
        </>
      ) : (
        <g className="blink">
          <ellipse cx={69 + gx} cy={62 + gy} rx="4.2" ry={eager ? 5.4 : 4.6} fill={ink} />
          <ellipse cx={91 + gx} cy={62 + gy} rx="4.2" ry={eager ? 5.4 : 4.6} fill={ink} />
          <circle cx={70.6 + gx} cy={60 + gy} r="1.5" fill="#fff" />
          <circle cx={92.6 + gx} cy={60 + gy} r="1.5" fill="#fff" />
        </g>
      )}

      {t.glasses ? (
        <g fill="none" stroke={ink} strokeWidth="2">
          <rect x="60" y="54" width="18" height="15" rx="6" fill="#fff" fillOpacity=".18" />
          <rect x="82" y="54" width="18" height="15" rx="6" fill="#fff" fillOpacity=".18" />
          <path d="M78 60 Q80 58 82 60" />
          <path d="M60 60 L52 58" />
          <path d="M100 60 L108 58" />
        </g>
      ) : null}

      {/* nose */}
      <path d="M80 66 Q83 72 79 74" fill="none" stroke="#000" strokeOpacity=".22" strokeWidth="2" strokeLinecap="round" />

      {/* cheeks */}
      <circle cx="62" cy="74" r="4.5" fill="#ff7a7a" opacity=".28" />
      <circle cx="98" cy="74" r="4.5" fill="#ff7a7a" opacity=".28" />
      {t.freckles ? (
        <g fill="#7a4a2a" opacity=".45">
          <circle cx="60" cy="71" r=".9" /><circle cx="64" cy="72" r=".9" /><circle cx="62" cy="75" r=".9" />
          <circle cx="96" cy="71" r=".9" /><circle cx="100" cy="72" r=".9" /><circle cx="98" cy="75" r=".9" />
        </g>
      ) : null}

      {/* mouth */}
      {pose === "needs_you" ? (
        <ellipse cx="80" cy="81" rx="4.5" ry="5" fill="#7a2e2e" />
      ) : happy ? (
        <path d="M70 78 Q80 90 90 78 Z" fill="#7a2e2e" />
      ) : worried ? (
        <path d="M71 83 Q75.5 79 80 83 Q84.5 87 89 83" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
      ) : asleep ? (
        <ellipse cx="80" cy="81" rx="2.6" ry="2" fill="#7a2e2e" />
      ) : pose === "call" ? (
        <ellipse className="talk" cx="80" cy="81" rx="4" ry="3" fill="#7a2e2e" />
      ) : pose === "thinking" ? (
        <path d="M75 82 Q80 80 85 83" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
      ) : pose === "review" || pose === "walking" ? (
        <path d="M72 79 Q80 87 88 79" fill="none" stroke={ink} strokeWidth="2.6" strokeLinecap="round" />
      ) : (
        <path d="M74 81 Q80 84 86 81" fill="none" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
      )}
      {worried ? <path d="M108 44 Q112 52 108 55 Q104 52 108 44 Z" fill="#7dd3fc" stroke="#38bdf8" strokeWidth="1" /> : null}
    </g>
  );
}

function HairBack({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 4: // long
      return <path d="M48 60 C46 30 66 28 80 28 C96 28 116 32 112 62 L116 112 C104 118 56 118 44 112 Z" fill={color} />;
    case 1: // bob
      return <path d="M47 64 C44 34 64 29 80 29 C98 29 116 34 113 64 L114 90 C104 96 56 96 46 90 Z" fill={color} />;
    case 3: // bun
      return <circle cx="80" cy="27" r="11" fill={color} />;
    default:
      return null;
  }
}

function HairFront({ style, color }: { style: number; color: string }) {
  switch (style) {
    case 0: // short crop
      return <path d="M50 62 C49 38 64 32 80 32 C97 32 112 39 110 62 C104 50 94 44 82 46 C70 44 58 50 50 62 Z" fill={color} />;
    case 1: // bob fringe
      return <path d="M50 64 C48 40 64 33 80 33 C97 33 112 40 110 64 C100 56 98 46 86 44 C82 52 64 54 50 64 Z" fill={color} />;
    case 2: // curly
      return (
        <g fill={color}>
          {[
            [56, 50, 10], [64, 40, 11], [76, 35, 11], [89, 36, 11], [100, 43, 10], [106, 54, 9],
            [52, 60, 8], [108, 63, 7], [70, 45, 8], [86, 44, 8],
          ].map(([cx, cy, r]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />
          ))}
        </g>
      );
    case 3: // bun, swept back
      return <path d="M51 60 C50 38 64 33 80 33 C96 33 110 38 109 60 C100 46 90 42 80 42 C70 42 60 46 51 60 Z" fill={color} />;
    case 4: // long, centre part
      return <path d="M50 66 C48 38 64 32 80 32 C96 32 112 38 110 66 C104 52 90 42 80 40 C70 42 56 52 50 66 Z" fill={color} />;
    case 5: // spiky
      return (
        <path
          d="M50 60 L52 40 L60 46 L64 30 L72 40 L80 26 L88 40 L96 30 L100 46 L108 40 L110 60 C100 48 90 46 80 46 C70 46 60 48 50 60 Z"
          fill={color}
        />
      );
    case 6: // beanie
      return (
        <g>
          <path d="M49 58 C48 30 66 26 80 26 C94 26 112 30 111 58 Z" fill={color} />
          <rect x="47" y="52" width="66" height="10" rx="5" fill={color} />
          <rect x="47" y="52" width="66" height="10" rx="5" fill="#fff" opacity=".18" />
          <circle cx="80" cy="24" r="6" fill={color} />
        </g>
      );
    default: // side swoop
      return <path d="M50 62 C48 36 66 31 82 31 C100 31 112 40 110 58 C98 46 76 50 62 46 C58 50 54 56 50 62 Z" fill={color} />;
  }
}

function Headset() {
  return (
    <g>
      <path d="M50 64 C50 30 110 30 110 64" fill="none" stroke="#27272a" strokeWidth="4" />
      <rect x="44" y="58" width="10" height="16" rx="4" fill="#27272a" />
      <rect x="106" y="58" width="10" height="16" rx="4" fill="#27272a" />
      <path d="M50 72 Q56 86 72 84" fill="none" stroke="#27272a" strokeWidth="2.4" />
      <circle cx="73" cy="84" r="2.6" fill="#ef4444" />
    </g>
  );
}

const sleeve = (color: string) => ({ stroke: color, strokeWidth: 11, strokeLinecap: "round" as const, fill: "none" });

function Arms({ t, pose }: { t: Traits; pose: Pose }) {
  const hand = (cx: number, cy: number, cls?: string) => <circle className={cls} cx={cx} cy={cy} r="6.5" fill={t.skin} />;

  if (pose === "working") {
    return (
      <g>
        <g className="type-l">
          <path d="M56 116 Q50 126 64 130" {...sleeve(t.outfit)} />
          {hand(66, 130)}
        </g>
        <g className="type-r">
          <path d="M104 116 Q110 126 96 130" {...sleeve(t.outfit)} />
          {hand(94, 130)}
        </g>
      </g>
    );
  }
  if (pose === "thinking") {
    return (
      <g>
        <path d="M56 116 Q50 126 64 130" {...sleeve(t.outfit)} />
        {hand(66, 130)}
        <path d="M104 116 Q116 104 96 92" {...sleeve(t.outfit)} />
        {hand(92, 90)}
      </g>
    );
  }
  if (pose === "reading") {
    return (
      <g className="bob">
        <path d="M56 116 Q50 124 60 120" {...sleeve(t.outfit)} />
        <path d="M104 116 Q110 124 100 120" {...sleeve(t.outfit)} />
        <path d="M80 104 L58 98 L58 124 L80 128 Z" fill="#fff" stroke="#cbd5e1" strokeWidth="1.2" />
        <path d="M80 104 L102 98 L102 124 L80 128 Z" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.2" />
        <path d="M63 106 L76 109 M63 112 L76 115 M84 109 L97 106 M84 115 L97 112" stroke="#94a3b8" strokeWidth="1.4" />
        <path d="M80 104 L80 128" stroke="#b91c1c" strokeWidth="2" />
        {hand(60, 120)}
        {hand(100, 120)}
      </g>
    );
  }
  if (pose === "call") {
    return (
      <g>
        <path d="M56 116 Q50 126 64 130" {...sleeve(t.outfit)} />
        {hand(66, 130)}
        <path d="M104 116 Q124 104 114 80" {...sleeve(t.outfit)} />
        <rect x="108" y="58" width="9" height="20" rx="3" fill="#18181b" transform="rotate(14 112 68)" />
        {hand(114, 76)}
      </g>
    );
  }
  if (pose === "needs_you") {
    return (
      <g>
        <path d="M56 116 Q50 126 64 130" {...sleeve(t.outfit)} />
        {hand(66, 130)}
        <g className="wave">
          <path d="M106 114 Q122 100 124 76" {...sleeve(t.outfit)} />
          <ellipse cx="124" cy="70" rx="7" ry="8" fill={t.skin} />
          <path d="M119 63 L119 58 M123 62 L123 56 M127 62 L127 57" stroke={t.skin} strokeWidth="3.4" strokeLinecap="round" />
        </g>
      </g>
    );
  }
  if (pose === "review") {
    return (
      <g>
        <g className="bob">
          <path d="M56 116 Q48 104 58 92" {...sleeve(t.outfit)} />
          <path d="M104 116 Q112 104 102 92" {...sleeve(t.outfit)} />
          <rect x="54" y="72" width="52" height="36" rx="3" fill="#fff" stroke="#d4d4d8" strokeWidth="1.5" transform="rotate(-4 80 90)" />
          <path d="M60 80 H96 M60 87 H92 M60 94 H84" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" transform="rotate(-4 80 90)" />
          <path d="M88 96 L92 100 L100 90" stroke="#10b981" strokeWidth="3" fill="none" strokeLinecap="round" transform="rotate(-4 80 90)" />
          {hand(58, 96)}
          {hand(102, 94)}
        </g>
      </g>
    );
  }
  if (pose === "done") {
    return (
      <g>
        <path d="M56 114 Q40 98 42 74" {...sleeve(t.outfit)} />
        <path d="M104 114 Q120 98 118 74" {...sleeve(t.outfit)} />
        {hand(42, 68)}
        {hand(118, 68)}
      </g>
    );
  }
  if (pose === "failed") {
    return (
      <g>
        <path d="M56 116 Q44 96 56 80" {...sleeve(t.outfit)} />
        <path d="M104 116 Q116 96 104 80" {...sleeve(t.outfit)} />
        {hand(56, 76)}
        {hand(104, 76)}
      </g>
    );
  }
  // idle: arms folded on the desk
  return (
    <g>
      <path d="M58 118 Q60 130 86 128" {...sleeve(t.outfit)} />
      <path d="M102 118 Q100 130 74 128" {...sleeve(t.outfit)} />
      {hand(88, 127)}
      {hand(72, 127)}
    </g>
  );
}

function StandingArms({ t, pose, carry }: { t: Traits; pose: Pose; carry?: "mug" | "paper" }) {
  const hand = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="6.5" fill={t.skin} />;
  if (pose === "needs_you" || pose === "review" || pose === "done") return <Arms t={t} pose={pose} />;
  const walking = pose === "walking";
  return (
    <g>
      <g className={walking ? "swing-l" : undefined}>
        <path d="M54 114 Q46 130 48 148" {...sleeve(t.outfit)} />
        {hand(48, 152)}
      </g>
      {carry === "mug" ? (
        <g>
          <path d="M106 114 Q116 128 106 138" {...sleeve(t.outfit)} />
          <rect x="100" y="132" width="16" height="16" rx="3" fill="#fff" stroke="#a1a1aa" strokeWidth="1.5" />
          <path d="M116 136 Q122 140 116 144" stroke="#a1a1aa" strokeWidth="2.4" fill="none" />
          <path className="steam" d="M104 128 Q102 124 105 120 M110 128 Q108 124 111 120" stroke="#cbd5e1" strokeWidth="2" fill="none" strokeLinecap="round" />
          {hand(104, 140)}
        </g>
      ) : carry === "paper" ? (
        <g>
          <path d="M106 114 Q116 128 106 136" {...sleeve(t.outfit)} />
          <rect x="98" y="122" width="22" height="28" rx="2" fill="#fff" stroke="#d4d4d8" strokeWidth="1.2" transform="rotate(8 109 136)" />
          {hand(106, 138)}
        </g>
      ) : (
        <g className={walking ? "swing-r" : undefined}>
          <path d="M106 114 Q114 130 112 148" {...sleeve(t.outfit)} />
          {hand(112, 152)}
        </g>
      )}
    </g>
  );
}

function Legs({ walking }: { walking: boolean }) {
  return (
    <g>
      <g className={walking ? "leg-l" : undefined}>
        <rect x="63" y="146" width="14" height="38" rx="6" fill="#334155" />
        <ellipse cx="68" cy="186" rx="10" ry="5" fill="#1f2937" />
      </g>
      <g className={walking ? "leg-r" : undefined}>
        <rect x="83" y="146" width="14" height="38" rx="6" fill="#3f4b63" />
        <ellipse cx="92" cy="186" rx="10" ry="5" fill="#1f2937" />
      </g>
    </g>
  );
}

function Stethoscope() {
  return (
    <g fill="none" stroke="#475569" strokeWidth="2.6" strokeLinecap="round">
      <path d="M68 104 Q66 126 78 128 Q90 126 92 104" />
      <circle cx="78" cy="132" r="4" fill="#cbd5e1" stroke="#475569" />
    </g>
  );
}

function Desk({ t, pose }: { t: Traits; pose: Pose }) {
  const screenOn = pose !== "idle";
  return (
    <g>
      {/* monitor */}
      <rect x="10" y="88" width="40" height="30" rx="4" fill="#1f2937" />
      <rect x="13" y="91" width="34" height="23" rx="2" fill={screenOn ? "#a5f3fc" : "#334155"} />
      {screenOn ? (
        <g className={pose === "working" ? "scroll" : undefined} stroke="#0e7490" strokeWidth="2" strokeLinecap="round" opacity=".7">
          <path d="M17 96 H34" />
          <path d="M17 101 H40" />
          <path d="M21 106 H36" />
          <path d="M17 111 H30" />
        </g>
      ) : null}
      <rect x="26" y="118" width="8" height="10" fill="#374151" />
      {/* desk */}
      <rect x="4" y="126" width="152" height="10" rx="3" fill="#c08457" />
      <rect x="4" y="126" width="152" height="3" rx="1.5" fill="#fff" opacity=".25" />
      <rect x="10" y="136" width="140" height="24" fill="#a76d42" />
      <rect x="18" y="141" width="40" height="7" rx="3.5" fill="#8a5632" />
      {pose === "working" ? <rect x="60" y="122" width="40" height="6" rx="2" fill="#e4e4e7" stroke="#a1a1aa" strokeWidth="1" /> : null}
      <DeskProp prop={t.prop} pose={pose} />
    </g>
  );
}

/** The role prop, standing on the right side of the desk. */
function DeskProp({ prop, pose }: { prop: PropKind; pose: Pose }) {
  const at = (children: React.ReactNode) => <g transform="translate(118 98)">{children}</g>;
  switch (prop) {
    case "magnifier":
      return at(
        <g>
          <circle cx="14" cy="12" r="10" fill="#e0f2fe" stroke="#0f172a" strokeWidth="3.5" />
          <path d="M21 19 L32 29" stroke="#78350f" strokeWidth="6" strokeLinecap="round" />
          <path d="M9 9 Q12 5 16 6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>,
      );
    case "laptop":
      return at(
        <g>
          <rect x="2" y="6" width="30" height="20" rx="2" fill="#475569" />
          <rect x="5" y="9" width="24" height="14" rx="1" fill={pose === "idle" ? "#334155" : "#c7d2fe"} />
          <rect x="-2" y="26" width="38" height="4" rx="2" fill="#94a3b8" />
        </g>,
      );
    case "megaphone":
      return at(
        <g transform="rotate(-18 16 18)">
          <path d="M4 14 L24 4 L24 30 L4 20 Z" fill="#f97316" />
          <rect x="0" y="13" width="7" height="8" rx="2" fill="#fdba74" />
          <path d="M8 21 L10 29" stroke="#7c2d12" strokeWidth="3" strokeLinecap="round" />
          <path d="M28 10 Q33 17 28 24" stroke="#f97316" strokeWidth="2" fill="none" strokeLinecap="round" className="pulse" />
        </g>,
      );
    case "palette":
      return at(
        <g>
          <path d="M16 4 C30 4 36 14 32 22 C29 28 22 24 20 28 C18 32 10 32 6 26 C0 18 4 4 16 4 Z" fill="#fde68a" stroke="#b45309" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="3" fill="#ef4444" />
          <circle cx="20" cy="10" r="3" fill="#3b82f6" />
          <circle cx="27" cy="15" r="3" fill="#10b981" />
          <circle cx="11" cy="21" r="3" fill="#8b5cf6" />
        </g>,
      );
    case "chart":
      return at(
        <g>
          <rect x="0" y="2" width="34" height="26" rx="2" fill="#fff" stroke="#a1a1aa" strokeWidth="1.5" />
          <rect x="5" y="16" width="5" height="9" fill="#60a5fa" />
          <rect x="13" y="11" width="5" height="14" fill="#34d399" />
          <rect x="21" y="6" width="5" height="19" fill="#f472b6" />
          <path d="M14 28 L10 30 M20 28 L24 30" stroke="#71717a" strokeWidth="2" />
        </g>,
      );
    case "calculator":
      return at(
        <g>
          <rect x="6" y="2" width="22" height="28" rx="3" fill="#334155" />
          <rect x="9" y="5" width="16" height="6" rx="1" fill="#bbf7d0" />
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={9 + c * 6} y={14 + r * 5} width="4" height="3" rx="1" fill={c === 2 && r === 2 ? "#f97316" : "#cbd5e1"} />),
          )}
        </g>,
      );
    case "wrench":
      return at(
        <g transform="rotate(35 16 16)">
          <rect x="13" y="6" width="7" height="26" rx="3" fill="#94a3b8" />
          <path d="M8 2 C8 10 26 10 26 2 L22 2 L22 6 L12 6 L12 2 Z" fill="#94a3b8" />
        </g>,
      );
    case "chip":
      return at(
        <g>
          {[4, 10, 16, 22].map((x) => (
            <g key={x} stroke="#d4d4d8" strokeWidth="2">
              <path d={`M${x + 4} 2 V6`} />
              <path d={`M${x + 4} 26 V30`} />
            </g>
          ))}
          <rect x="4" y="6" width="26" height="20" rx="3" fill="#166534" />
          <rect x="11" y="11" width="12" height="10" rx="1.5" fill="#1f2937" />
          <circle className="pulse" cx="27" cy="9" r="1.6" fill="#facc15" />
        </g>,
      );
    case "notepad":
      return at(
        <g>
          <rect x="4" y="2" width="24" height="28" rx="2" fill="#fef9c3" stroke="#ca8a04" strokeWidth="1.2" />
          <path d="M8 10 H24 M8 15 H24 M8 20 H20" stroke="#a16207" strokeWidth="1.4" />
          <path d="M26 8 L34 0" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
        </g>,
      );
    case "phone":
      return at(
        <g>
          <rect x="9" y="2" width="16" height="28" rx="3" fill="#18181b" />
          <rect x="11" y="5" width="12" height="20" rx="1" fill="#86efac" />
          <circle cx="17" cy="27.5" r="1.2" fill="#52525b" />
          {pose === "needs_you" ? null : <path className="pulse" d="M27 6 Q31 10 27 14" stroke="#22c55e" strokeWidth="2" fill="none" />}
        </g>,
      );
    case "box":
      return at(
        <g>
          <rect x="2" y="8" width="30" height="22" rx="2" fill="#d6a15c" />
          <path d="M2 8 L8 2 L38 2 L32 8 Z" fill="#e8bb7e" />
          <rect x="14" y="8" width="6" height="22" fill="#f5deb3" opacity=".7" />
        </g>,
      );
    case "camera":
      return at(
        <g>
          <rect x="2" y="10" width="32" height="20" rx="4" fill="#27272a" />
          <rect x="8" y="6" width="10" height="6" rx="2" fill="#27272a" />
          <circle cx="18" cy="20" r="7" fill="#52525b" stroke="#a1a1aa" strokeWidth="2" />
          <circle cx="18" cy="20" r="3" fill="#0ea5e9" />
          <circle className="pulse" cx="29" cy="14" r="1.6" fill="#ef4444" />
        </g>,
      );
    case "stethoscope":
      return at(
        <g>
          <rect x="4" y="10" width="28" height="20" rx="3" fill="#fff" stroke="#ef4444" strokeWidth="2" />
          <path d="M18 14 V26 M12 20 H24" stroke="#ef4444" strokeWidth="3.5" />
        </g>,
      );
    case "map":
      return at(
        <g>
          <path d="M0 8 L11 4 L22 8 L34 4 L34 28 L22 32 L11 28 L0 32 Z" fill="#fef3c7" stroke="#b45309" strokeWidth="1.2" />
          <path d="M11 4 V28 M22 8 V32" stroke="#d97706" strokeWidth="1" />
          <path d="M4 22 Q12 14 18 20 T30 12" stroke="#ef4444" strokeWidth="1.6" strokeDasharray="2 2" fill="none" />
          <circle cx="30" cy="12" r="2.2" fill="#ef4444" />
        </g>,
      );
    case "bag":
      return at(
        <g>
          <path d="M6 12 L28 12 L32 32 L2 32 Z" fill="#f472b6" />
          <path d="M11 12 Q11 2 17 2 Q23 2 23 12" stroke="#be185d" strokeWidth="2.4" fill="none" />
          <circle cx="17" cy="22" r="3" fill="#fff" opacity=".7" />
        </g>,
      );
    case "code":
      return at(
        <g>
          <rect x="0" y="4" width="34" height="24" rx="3" fill="#0f172a" />
          <path d="M9 11 L4 16 L9 21 M25 11 L30 16 L25 21 M19 9 L15 23" stroke="#4ade80" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          <path d="M14 28 L12 32 M20 28 L22 32" stroke="#475569" strokeWidth="2" />
        </g>,
      );
    case "headset":
    case "mug":
    default:
      return at(
        <g transform="translate(4 6)">
          <rect x="4" y="8" width="18" height="18" rx="3" fill="#fff" stroke="#a1a1aa" strokeWidth="1.5" />
          <path d="M22 12 Q30 14 22 22" stroke="#a1a1aa" strokeWidth="3" fill="none" />
          <path className="steam" d="M10 4 Q8 0 11 -4 M16 4 Q14 0 17 -4" stroke="#cbd5e1" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>,
      );
  }
}

function Overlay({ pose }: { pose: Pose }) {
  if (pose === "idle") {
    return (
      <g fill="#6366f1" fontFamily="ui-rounded, system-ui" fontWeight="800">
        <text className="zz z1" x="112" y="40" fontSize="12">z</text>
        <text className="zz z2" x="122" y="28" fontSize="15">z</text>
        <text className="zz z3" x="134" y="14" fontSize="18">Z</text>
      </g>
    );
  }
  if (pose === "thinking") {
    return (
      <g className="think">
        <circle cx="114" cy="40" r="3" fill="#fff" stroke="#cbd5e1" />
        <circle cx="122" cy="30" r="4.5" fill="#fff" stroke="#cbd5e1" />
        <ellipse cx="138" cy="16" rx="16" ry="11" fill="#fff" stroke="#cbd5e1" />
        <circle className="dot d1" cx="131" cy="16" r="2" fill="#94a3b8" />
        <circle className="dot d2" cx="138" cy="16" r="2" fill="#94a3b8" />
        <circle className="dot d3" cx="145" cy="16" r="2" fill="#94a3b8" />
      </g>
    );
  }
  if (pose === "call") {
    return (
      <g stroke="#22c55e" strokeWidth="2.2" fill="none" strokeLinecap="round">
        <path className="wave1" d="M126 52 Q132 60 126 68" />
        <path className="wave2" d="M132 46 Q141 60 132 74" />
      </g>
    );
  }
  if (pose === "needs_you") {
    return (
      <g className="pop">
        <circle cx="140" cy="36" r="11" fill="#ef4444" />
        <text x="140" y="42" textAnchor="middle" fontSize="16" fontWeight="900" fill="#fff" fontFamily="ui-rounded, system-ui">!</text>
      </g>
    );
  }
  if (pose === "failed") {
    return (
      <g className="pop">
        <circle cx="140" cy="36" r="11" fill="#f97316" />
        <text x="140" y="41" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff" fontFamily="ui-rounded, system-ui">?!</text>
      </g>
    );
  }
  if (pose === "done") {
    return (
      <g className="confetti">
        <rect x="28" y="30" width="5" height="5" fill="#f472b6" transform="rotate(20 30 32)" />
        <rect x="128" y="24" width="5" height="5" fill="#60a5fa" transform="rotate(-20 130 26)" />
        <circle cx="40" cy="18" r="3" fill="#facc15" />
        <circle cx="118" cy="44" r="3" fill="#34d399" />
        <rect x="136" y="52" width="4" height="7" fill="#a78bfa" transform="rotate(30 138 55)" />
      </g>
    );
  }
  return null;
}
