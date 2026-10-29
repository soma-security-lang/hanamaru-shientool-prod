export type HelpActor = {
  id: string;
  roles: string[];
  features: Record<string, boolean>;
};
export type HelpSection = { id: string; title: string; text: string };
export type HelpArticle = {
  slug: string;
  title: string;
  category: string;
  audience: string;
  updated: string;
  roles: string[];
  features: string[];
  screens: { label: string; href: string }[];
  keywords: string[];
  body: string;
  sections: HelpSection[];
};
export type HelpCatalog = {
  product: string;
  name: string;
  revision: string;
  examples: string[];
  articles: HelpArticle[];
  otherApps: {
    product: string;
    label: string;
    href: string;
    keywords: string[];
  }[];
};
export type HelpAnswer = {
  kind:
    | "answer"
    | "clarify"
    | "not_found"
    | "restricted"
    | "unavailable"
    | "cross_app";
  message: string;
  sections: HelpSection[];
  sources: { label: string; href: string }[];
  screens: { label: string; href: string }[];
};
export type HelpQuestion = {
  question: string;
  history: { question: string; sourceSlugs: string[] }[];
};
export class HelpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function visibleArticles(catalog: HelpCatalog, actor: HelpActor) {
  return catalog.articles.filter(
    (a) =>
      (a.roles.length === 0 || actor.roles.some((r) => a.roles.includes(r))) &&
      a.features.every((f) => actor.features[f] === true),
  );
}
export function parseQuestion(value: unknown): HelpQuestion {
  if (!value || typeof value !== "object")
    throw new HelpError(400, "質問を入力してください。");
  const v = value as Record<string, unknown>;
  if (
    typeof v.question !== "string" ||
    !v.question.trim() ||
    v.question.length > 1000
  )
    throw new HelpError(400, "質問は1〜1000文字で入力してください。");
  const history = v.history ?? [];
  if (!Array.isArray(history) || history.length > 6)
    throw new HelpError(
      400,
      "会話が長くなりました。会話をクリアしてください。",
    );
  const cleaned = history.map((h: unknown) => {
    if (!h || typeof h !== "object")
      throw new HelpError(400, "会話の形式を確認してください。");
    const x = h as Record<string, unknown>;
    if (
      typeof x.question !== "string" ||
      x.question.length > 1000 ||
      !Array.isArray(x.sourceSlugs) ||
      x.sourceSlugs.length > 3 ||
      !x.sourceSlugs.every(
        (s) => typeof s === "string" && /^[a-z0-9-]{1,80}$/.test(s),
      )
    )
      throw new HelpError(400, "会話の形式を確認してください。");
    return { question: x.question, sourceSlugs: x.sourceSlugs as string[] };
  });
  return { question: v.question.trim(), history: cleaned };
}
const normalize = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const grams = (s: string) => {
  const n = normalize(s).replace(/[。、？！?!「」：:・]/g, "");
  return new Set(
    Array.from({ length: Math.max(0, n.length - 1) }, (_, i) =>
      n.slice(i, i + 2),
    ),
  );
};
export function searchArticles(articles: HelpArticle[], query: string) {
  if (!query.trim()) return articles.map((article) => ({ article, score: 1 }));
  const q = normalize(query),
    g = grams(query);
  return articles
    .map((article) => {
      const title = normalize(article.title + " " + article.keywords.join(" ")),
        text = normalize(article.body);
      let score = 0;
      for (const k of article.keywords)
        if (q.includes(normalize(k))) score += 12;
      for (const x of grams(title)) if (g.has(x)) score += 2;
      for (const x of g) if (text.includes(x)) score += 0.15;
      return { article, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
}
const windows = new Map<
  string,
  { start: number; count: number; pending: boolean }
>();
export function questionLease(key: string, now = Date.now()) {
  for (const [k, v] of windows)
    if (now - v.start > 60000 && !v.pending) windows.delete(k);
  const old = windows.get(key);
  const bucket = old ?? { start: now, count: 0, pending: false };
  if (bucket.pending || bucket.count >= 10)
    throw new HelpError(
      429,
      "続けて質問しています。少し待ってからお試しください。",
    );
  if (windows.size >= 10000 && !old)
    throw new HelpError(
      429,
      "質問が混み合っています。少し待ってからお試しください。",
    );
  bucket.count++;
  bucket.pending = true;
  windows.set(key, bucket);
  return () => {
    bucket.pending = false;
  };
}
export type HelpSelection = {
  slug: string;
  sectionIds: string[];
  clarify: boolean;
};
export type HelpSelector = (
  question: string,
  history: HelpQuestion["history"],
  articles: HelpArticle[],
) => Promise<HelpSelection>;
export async function answerQuestion(
  catalog: HelpCatalog,
  actor: HelpActor,
  input: HelpQuestion,
  select: HelpSelector,
  enabled = true,
): Promise<HelpAnswer> {
  const empty = (
    kind: HelpAnswer["kind"],
    message: string,
    sources: HelpAnswer["sources"] = [],
  ): HelpAnswer => ({ kind, message, sections: [], sources, screens: [] });
  const q = input.question;
  if (
    /(?:申請|登録|更新|削除|承認|発注|打刻).{0,12}(?:しておいて|実行して|代わりに|しといて)|(?:私|わたし|自分)の.{0,18}(?:何日|いくら|教えて|残って|状況を確認)/.test(
      q,
    )
  )
    return empty(
      "restricted",
      "ここでは操作方法をご案内します。実際の状況は該当画面で確認し、申請や登録はご自身で操作してください。",
    );
  const other = catalog.otherApps.find((a) =>
    a.keywords.some((k) => q.includes(k)),
  );
  if (other)
    return empty(
      "cross_app",
      `${other.label}の操作は、そちらのヘルプをご利用ください。`,
      [{ label: other.label + "のヘルプ", href: other.href }],
    );
  const allowed = visibleArticles(catalog, actor);
  let query = q;
  const follow =
    /^(その|それ|続き|次|修正|変更|戻|取消|取り消|やり直)/.test(q) &&
    q.length < 45;
  if (follow && input.history.length) {
    const last = input.history.at(-1)!;
    const previous = allowed.filter((a) => last.sourceSlugs.includes(a.slug));
    query =
      previous.map((a) => a.title).join(" ") + " " + last.question + " " + q;
  }
  const ranked = searchArticles(allowed, query).slice(0, 4);
  if (!ranked.length)
    return empty(
      "not_found",
      "このヘルプでは確認できませんでした。操作する画面名や、表示されているメッセージを教えてください。",
    );
  const sources = ranked
    .slice(0, 3)
    .map((x) => ({ label: x.article.title, href: "/help/" + x.article.slug }));
  if (!enabled)
    return empty(
      "unavailable",
      "質問への回答は現在利用できません。関連する手順書をご確認ください。",
      sources,
    );
  let choice: HelpSelection;
  try {
    choice = await select(
      q,
      input.history,
      ranked.map((x) => x.article),
    );
  } catch {
    return empty(
      "unavailable",
      "回答を取得できませんでした。関連する手順書から操作方法を確認できます。",
      sources,
    );
  }
  if (choice.clarify)
    return empty(
      "clarify",
      "どの画面の、どの操作についてお困りですか？以下の手順も参考にしてください。",
      sources,
    );
  const article = ranked.find((x) => x.article.slug === choice.slug)?.article;
  if (!article || !Array.isArray(choice.sectionIds))
    return empty(
      "not_found",
      "根拠となる手順を特定できませんでした。関連する記事をご確認ください。",
      sources,
    );
  const sections = article.sections
    .filter((s) => choice.sectionIds.includes(s.id))
    .slice(0, 4);
  if (!sections.length)
    return empty(
      "not_found",
      "該当する手順を確認できませんでした。記事全体をご確認ください。",
      sources,
    );
  // The model selects approved excerpts; every displayed instruction is copied from the canonical Markdown.
  return {
    kind: "answer",
    message: `「${article.title}」の手順をご案内します。`,
    sections,
    sources: [{ label: article.title, href: "/help/" + article.slug }],
    screens: article.screens,
  };
}
export async function readQuestionBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HelpError(400, "質問を入力してください。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) throw new HelpError(413, "入力が大きすぎます。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  } catch {
    throw new HelpError(400, "質問の形式を確認してください。");
  }
}
