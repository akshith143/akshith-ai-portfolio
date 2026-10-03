// Public GitHub data, fetched at startup and refreshed in the background so a
// visitor's request never waits on GitHub.

export interface RepoSummary {
  name: string;
  description: string;
  language: string | null;
  url: string;
  pushedAt: string;
  fork: boolean;
}

const USER = "akshith143";
const REFRESH_MS = 6 * 60 * 60 * 1000;

let repos: RepoSummary[] = [];
let lastFetched = 0;

async function fetchRepos(): Promise<RepoSummary[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "akshith-ai-portfolio",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const res = await fetch(`https://api.github.com/users/${USER}/repos?per_page=100&sort=pushed`, {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const data = (await res.json()) as Array<Record<string, unknown>>;
  return data
    .filter((r) => r.name !== USER) // profile-README repo
    .map((r) => ({
      name: String(r.name),
      description: (r.description as string | null) ?? "",
      language: (r.language as string | null) ?? null,
      url: String(r.html_url),
      pushedAt: String(r.pushed_at).slice(0, 10),
      fork: Boolean(r.fork),
    }));
}

export async function refreshRepos(): Promise<void> {
  try {
    repos = await fetchRepos();
    lastFetched = Date.now();
  } catch (err) {
    console.warn(`[github] refresh failed, keeping ${repos.length} cached repos:`, (err as Error).message);
  }
}

export function startRepoRefresh(onChange: () => void): Promise<void> {
  const tick = async () => {
    const before = JSON.stringify(repos);
    await refreshRepos();
    if (JSON.stringify(repos) !== before) onChange();
  };
  setInterval(tick, REFRESH_MS).unref();
  return tick();
}

export const getRepos = () => repos;
export const reposFetchedAt = () => lastFetched;
