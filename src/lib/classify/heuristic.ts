import { hash, slugify } from "../text";
import { repairProposal, type PropKindName, type Proposal, type ProposalProject, type SessionDigest } from "./schema";

/**
 * Rules-based organiser for when the Claude CLI is not available.
 * Project = repo owner (or repo / claude.ai project / "Personal"), team and role from keywords.
 */

interface Discipline {
  team: string;
  role: string;
  prop: PropKindName;
  words: RegExp;
}

const DISCIPLINES: Discipline[] = [
  { team: "Marketing", role: "SEO Lead", prop: "magnifier", words: /\b(seo|search console|keyword|sitemap|meta tags?|rank(ing)?)\b/i },
  { team: "Marketing", role: "Growth Marketer", prop: "megaphone", words: /\b(ads?|landing pages?|campaigns?|marketing|funnel|conversion|aida|reddit ads)\b/i },
  { team: "Marketing", role: "Content Writer", prop: "notepad", words: /\b(blog|copy(writing)?|newsletter|content|article|social post)\b/i },
  { team: "Hardware", role: "Hardware Engineer", prop: "chip", words: /\b(pcb|firmware|circuit|esp32|hardware|dongle|schematic|solder|button)\b/i },
  { team: "Commerce", role: "E-commerce Manager", prop: "bag", words: /\b(shopify|storefront|e-?commerce|product listings?|checkout|cart)\b/i },
  { team: "Media", role: "Video Producer", prop: "camera", words: /\b(video|youtube|photo(shoot)?|reel|tiktok|thumbnail)\b/i },
  { team: "Health", role: "Health Advisor", prop: "stethoscope", words: /\b(health|medical|clinic|doctor|anesthe\w*|dose|patient)\b/i },
  { team: "Travel", role: "Trip Planner", prop: "map", words: /\b(trip|travel|itinerary|flight|hotel|hike|packing)\b/i },
  { team: "Design", role: "Product Designer", prop: "palette", words: /\b(design|ui|ux|logo|figma|brand(ing)?|mockup)\b/i },
  { team: "Finance", role: "Finance Manager", prop: "calculator", words: /\b(invoices?|accounting|zoho|tax|bookkeeping|finance|budget|expenses?|bills?)\b/i },
  { team: "Data", role: "Data Analyst", prop: "chart", words: /\b(analytics|reports?|dashboards?|posthog|metrics|kpis?)\b/i },
  { team: "Operations", role: "Operations Manager", prop: "box", words: /\b(amazon|inventory|shipments?|fba|suppliers?|logistics|tenders?|procurement|orders?)\b/i },
  { team: "Sales", role: "Sales Lead", prop: "phone", words: /\b(outreach|sales|crm|leads?|prospects?|whatsapp|deals?)\b/i },
  { team: "Support", role: "Support Lead", prop: "headset", words: /\b(support|tickets?|helpdesk|customer service)\b/i },
];

const ENGINEERING: Discipline = { team: "Engineering", role: "Software Engineer", prop: "code", words: /./ };
const GENERALIST: Discipline = { team: "Studio", role: "Research Assistant", prop: "mug", words: /./ };

/** The prop that fits a job title ("SEO Lead" → magnifier); a mug when nothing matches. */
export function propForRole(role: string): PropKindName {
  return DISCIPLINES.find((d) => d.words.test(role))?.prop ?? (/engineer|developer|dev\b|code/i.test(role) ? "code" : "mug");
}

const NAMES = [
  "Maya", "Omar", "Lena", "Kofi", "Ines", "Ravi", "Sofia", "Yusuf", "Aiko", "Mateo", "Nadia", "Theo",
  "Zara", "Hugo", "Amara", "Felix", "Leila", "Jonah", "Priya", "Elias", "Noor", "Diego", "Hana", "Sami",
];

const EMOJI = ["🚀", "🛍️", "🦆", "🧪", "🌿", "🏗️", "🎯", "📦", "🧭", "🎨"];

/** One project per repo (or claude.ai project / local folder); chats with neither go to "Personal". */
function projectLabel(s: SessionDigest): string {
  if (s.repo && s.repo.includes("/")) return s.repo.split("/")[1];
  return s.repo ?? s.workspace ?? "Personal";
}

/** The GitHub org is the company; everything else has none. */
function companyLabel(s: SessionDigest): string | null {
  return s.repo && s.repo.includes("/") ? prettify(s.repo.split("/")[0]) : null;
}

function prettify(label: string): string {
  return label
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function proposeHeuristically(sessions: SessionDigest[]): Proposal {
  const projects = new Map<string, ProposalProject>();
  const usedNames = new Set<string>();
  const assignments: Proposal["assignments"] = [];

  for (const s of sessions) {
    const label = projectLabel(s);
    const pKey = slugify(label);
    if (!projects.has(pKey)) {
      projects.set(pKey, {
        key: pKey,
        name: prettify(label),
        company: companyLabel(s),
        description: s.repo ? `Work across ${label}` : "Chats and one-off sessions",
        emoji: EMOJI[hash(pKey) % EMOJI.length],
        teams: [],
        goals: [],
      });
    }
    const project = projects.get(pKey)!;

    const text = [s.title, s.first_user_message, s.status_detail].filter(Boolean).join(" ");
    const d = DISCIPLINES.find((x) => x.words.test(text)) ?? (s.repo ? ENGINEERING : GENERALIST);

    const tKey = `${pKey}:${slugify(d.team)}`;
    let team = project.teams.find((t) => t.key === tKey);
    if (!team) {
      team = { key: tKey, name: d.team, description: `${d.team} work for ${project.name}`, members: [] };
      project.teams.push(team);
    }
    const mKey = `${tKey}:${slugify(d.role)}`;
    if (!team.members.some((m) => m.key === mKey)) {
      const taken = usedNames;
      let i = hash(mKey) % NAMES.length;
      while (taken.has(NAMES[i]) && taken.size < NAMES.length) i = (i + 1) % NAMES.length;
      taken.add(NAMES[i]);
      team.members.push({ key: mKey, name: NAMES[i], role: d.role, persona: `Owns ${d.team.toLowerCase()} sessions for ${project.name}.`, prop: d.prop });
    }

    const attention =
      s.status === "needs_you" ? "respond" : s.status === "review" ? "review" : s.status === "failed" ? "unblock" : "none";
    assignments.push({
      session_id: s.id,
      project_key: pKey,
      team_key: tKey,
      member_key: mKey,
      goal_key: null,
      summary: s.title,
      attention,
      // Cloud sessions carry a crisp needs_action line; chat/local details are raw messages, so keep the default title.
      ask: attention !== "none" && s.source === "cloud" ? s.status_detail : null,
    });
  }

  return repairProposal({ projects: [...projects.values()], assignments });
}
