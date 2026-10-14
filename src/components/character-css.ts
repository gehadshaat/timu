/**
 * The `.character` animation rules, for avatars drawn as standalone SVG images (/api/avatar), which
 * can't see the page's stylesheet. They are a copy of the rules in src/app/globals.css, which
 * the inline characters use; avatar.test.ts fails if the two drift apart.
 */
export const CHARACTER_CSS = `
.character .type-l { animation: type 0.5s ease-in-out infinite; transform-box: fill-box; }
.character .type-r { animation: type 0.5s ease-in-out infinite 0.25s; transform-box: fill-box; }
@keyframes type { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.character .wave { animation: wave 1.1s ease-in-out infinite; transform-origin: 106px 114px; }
@keyframes wave { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(-14deg); } }
.character .bob { animation: bob 1.6s ease-in-out infinite; }
@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.character .blink { animation: blink 4.5s infinite; transform-origin: 80px 62px; }
@keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
.character .zz { animation: zz 2.4s ease-in-out infinite; opacity: 0; }
.character .z2 { animation-delay: 0.6s; }
.character .z3 { animation-delay: 1.2s; }
@keyframes zz { 0% { opacity: 0; transform: translate(0, 6px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(6px, -8px); } }
.character .pop { animation: pop 1.2s ease-in-out infinite; transform-origin: 140px 36px; }
@keyframes pop { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.15); } }
.character .pulse { animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.character .steam { animation: steam 2.2s ease-in-out infinite; }
@keyframes steam { 0% { opacity: 0; transform: translateY(2px); } 40% { opacity: 0.9; } 100% { opacity: 0; transform: translateY(-4px); } }
.character .scroll { animation: scroll 1.6s linear infinite; }
@keyframes scroll { 0% { transform: translateY(0); } 100% { transform: translateY(-5px); } }
.character .confetti { animation: confetti 1.8s ease-in-out infinite; }
@keyframes confetti { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px) rotate(2deg); } }
.character .talk { animation: talk 0.35s ease-in-out infinite alternate; transform-origin: 80px 81px; }
@keyframes talk { from { transform: scaleY(0.4); } to { transform: scaleY(1.2); } }
.character .dot { animation: dot 1.2s ease-in-out infinite; opacity: 0.3; }
.character .d2 { animation-delay: 0.2s; }
.character .d3 { animation-delay: 0.4s; }
@keyframes dot { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
.character .wave1, .character .wave2 { animation: pulse 1s ease-in-out infinite; }
.character .wave2 { animation-delay: 0.3s; }
.character .leg-l { animation: step 0.6s ease-in-out infinite; transform-origin: 70px 148px; }
.character .leg-r { animation: step 0.6s ease-in-out infinite reverse; transform-origin: 90px 148px; }
@keyframes step { 0%, 100% { transform: rotate(10deg); } 50% { transform: rotate(-10deg); } }
.character .swing-l { animation: step 0.6s ease-in-out infinite reverse; transform-origin: 54px 114px; }
.character .swing-r { animation: step 0.6s ease-in-out infinite; transform-origin: 106px 114px; }
@media (prefers-reduced-motion: reduce) {
  .character * { animation: none !important; }
}
`;
