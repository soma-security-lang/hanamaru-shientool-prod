"use client";
import Link from "next/link";
import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import type { HelpArticle, HelpAnswer, HelpQuestion } from "./engine";
import styles from "./HelpCenter.module.css";
type Props = {
  name: string;
  articles: HelpArticle[];
  examples: string[];
  slug?: string;
  ask: (input: HelpQuestion, signal: AbortSignal) => Promise<HelpAnswer>;
};
const safeLink = (href: string) =>
  (href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#");
function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g)
    .map((part, i) => {
      if (part.startsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
      const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      return m && safeLink(m[2]) ? (
        <a key={i} href={m[2]}>
          {m[1]}
        </a>
      ) : (
        part
      );
    });
}
export function HelpMarkdown({ body }: { body: string }) {
  const lines = body.split("\n"),
    blocks: ReactNode[] = [];
  let section = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^#{1,3} /.test(line)) {
      const text = line.replace(/^#{1,3} /, "");
      blocks.push(
        <h2 id={`section-${section++}`} key={i}>
          {inline(text)}
        </h2>,
      );
      continue;
    }
    const img = line.match(/^!\[([^\]]+)\]\((\/help-assets\/[a-z0-9/_.-]+)\)$/);
    if (img) {
      blocks.push(
        <figure key={i}>
          <Image
            width={1100}
            height={760}
            unoptimized
            src={img[2]}
            alt={img[1]}
            loading="lazy"
          />
          <figcaption>{img[1]}</figcaption>
        </figure>,
      );
      continue;
    }
    if (line.startsWith("|") && lines[i + 1]?.match(/^\|[\s:|-]+\|$/)) {
      const rows = [line];
      i += 1;
      while (lines[i + 1]?.trim().startsWith("|")) rows.push(lines[++i].trim());
      const cells = (s: string) =>
        s
          .split("|")
          .slice(1, -1)
          .map((x) => x.trim());
      blocks.push(
        <div className={styles.tableWrap} key={i}>
          <table>
            <thead>
              <tr>
                {cells(rows[0]).map((x, k) => (
                  <th scope="col" key={k}>
                    {inline(x)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, k) => (
                <tr key={k}>
                  {cells(row).map((x, j) => (
                    <td key={j}>{inline(x)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const ordered = /^\d+\. /.test(line),
      unordered = /^- /.test(line);
    if (ordered || unordered) {
      const items = [line.replace(/^(\d+\.|-) /, "")];
      while (
        lines[i + 1] &&
        (ordered ? /^\d+\. / : /^- /).test(lines[i + 1].trim())
      )
        items.push(lines[++i].trim().replace(/^(\d+\.|-) /, ""));
      const itemsJSX = items.map((x, k) => <li key={k}>{inline(x)}</li>);
      blocks.push(
        ordered ? <ol key={i}>{itemsJSX}</ol> : <ul key={i}>{itemsJSX}</ul>,
      );
      continue;
    }
    blocks.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className={styles.markdown}>{blocks}</div>;
}
export default function HelpCenter({
  name,
  articles,
  examples,
  slug,
  ask,
}: Props) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("すべて"),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [turns, setTurns] = useState<
    { question: string; answer: HelpAnswer }[]
  >([]);
  const request = useRef<AbortController | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const serial = useRef(0);
  useEffect(() => () => request.current?.abort(), []);
  const article = slug ? articles.find((a) => a.slug === slug) : undefined;
  const categories = ["すべて", "はじめに", "操作手順", "困ったとき", "用語"];
  const visible = useMemo(() => {
    const terms = query.normalize("NFKC").toLowerCase().trim().split(/\s+/);
    return articles.filter(
      (a) =>
        (category === "すべて" || a.category === category) &&
        terms.every((t) =>
          (a.title + " " + a.keywords.join(" ") + " " + a.body)
            .normalize("NFKC")
            .toLowerCase()
            .includes(t),
        ),
    );
  }, [articles, query, category]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !question.trim()) return;
    const current = ++serial.current,
      controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    const value = question.trim();
    try {
      const answer = await ask(
        {
          question: value,
          history: turns
            .slice(-6)
            .map((t) => ({
              question: t.question,
              sourceSlugs: t.answer.sources
                .map((s) => s.href.match(/^\/help\/([a-z0-9-]+)$/)?.[1])
                .filter((x): x is string => !!x),
            })),
        },
        controller.signal,
      );
      if (current !== serial.current) return;
      setTurns((old) => [...old.slice(-5), { question: value, answer }]);
      setQuestion("");
      setTimeout(() => answerRef.current?.focus(), 0);
    } catch (e) {
      if (
        current === serial.current &&
        !(e instanceof Error && e.name === "AbortError")
      )
        setError(
          "回答を取得できませんでした。記事検索をご利用いただくか、少し待ってからお試しください。",
        );
    } finally {
      if (current === serial.current) setBusy(false);
    }
  }
  function clear() {
    serial.current++;
    request.current?.abort();
    setTurns([]);
    setQuestion("");
    setBusy(false);
    setError("");
  }
  return (
    <div className={styles.root}>
      <header className={styles.heading}>
        <p>{name}</p>
        <h1>{article?.title ?? "ヘルプ・使い方"}</h1>
        <p>操作の手順や、困ったときの対処を確認できます。</p>
      </header>
      {slug ? (
        <>
          <Link href="/help">ヘルプの一覧へ戻る</Link>
          {article ? (
            <article className={styles.panel}>
              <p className={styles.meta}>
                対象：{article.audience} 更新：{article.updated}
              </p>
              <nav aria-label="記事の目次">
                <h2>目次</h2>
                <ul>
                  {article.sections.map((s) => (
                    <li key={s.id}>
                      <a href={"#" + s.id}>{s.title}</a>
                    </li>
                  ))}
                </ul>
              </nav>
              <HelpMarkdown body={article.body} />
              {article.screens.length > 0 && (
                <nav aria-label="関連する画面" className={styles.actions}>
                  {article.screens.map((s) => (
                    <a className={styles.action} href={s.href} key={s.href}>
                      {s.label}を開く
                    </a>
                  ))}
                </nav>
              )}
            </article>
          ) : (
            <section className={styles.panel}>
              <h2>記事が見つかりません</h2>
              <p>
                記事が存在しないか、現在の権限・機能設定では利用できません。
              </p>
            </section>
          )}
        </>
      ) : (
        <>
          <section
            className={styles.panel}
            aria-labelledby="help-question-title"
          >
            <h2 id="help-question-title">質問して操作を確認する</h2>
            <p>
              画面名や、やりたいことを入力してください。回答には参照した手順書を表示します。
            </p>
            <div className={styles.examples}>
              {examples.map((x) => (
                <button
                  type="button"
                  key={x}
                  onClick={() => setQuestion(x)}
                  disabled={busy}
                >
                  {x}
                </button>
              ))}
            </div>
            <form onSubmit={submit}>
              <label htmlFor="help-question">質問</label>
              <textarea
                id="help-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="例：申請を修正するには？"
                required
              />
              <p className={styles.meta}>
                個人情報・パスワードは入力しないでください。会話はこの画面内だけで保持します。
              </p>
              <div className={styles.actions}>
                <button
                  type="submit"
                  className={styles.primary}
                  disabled={busy || !question.trim()}
                >
                  {busy ? "手順を確認しています…" : "質問する"}
                </button>
                <button type="button" onClick={clear}>
                  会話をクリア
                </button>
              </div>
            </form>
            <div role="status" aria-live="polite">
              {busy ? "回答を準備しています。" : ""}
            </div>
            {error && <p role="alert">{error}</p>}
            <div ref={answerRef} tabIndex={-1} role="region" aria-label="質問への回答">
              {turns.map((t, i) => (
                <article className={styles.answer} key={i}>
                  <h3>質問：{t.question}</h3>
                  <p>{t.answer.message}</p>
                  {t.answer.sections.map((s) => (
                    <section key={s.id}>
                      <h4>{s.title}</h4>
                      <HelpMarkdown body={s.text} />
                    </section>
                  ))}
                  {t.answer.screens.length > 0 && (
                    <div className={styles.actions}>
                      {t.answer.screens.map((s) => (
                        <a className={styles.action} href={s.href} key={s.href}>
                          {s.label}を開く
                        </a>
                      ))}
                    </div>
                  )}
                  {t.answer.sources.length > 0 && (
                    <nav aria-label="回答の参照先">
                      <h4>参照した手順書・ヘルプ</h4>
                      <ul>
                        {t.answer.sources.map((s) => (
                          <li key={s.href}>
                            <a href={s.href}>{s.label}</a>
                          </li>
                        ))}
                      </ul>
                    </nav>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section
            className={styles.panel}
            aria-labelledby="help-articles-title"
          >
            <h2 id="help-articles-title">記事から探す</h2>
            <label htmlFor="help-search">キーワード</label>
            <input
              id="help-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="画面名・操作・エラーメッセージ"
            />
            <label htmlFor="help-category">カテゴリ</label>
            <select
              id="help-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <p role="status">{visible.length}件の記事</p>
            <div className={styles.grid}>
              {visible.map((a) => (
                <a
                  className={styles.card}
                  href={"/help/" + a.slug}
                  key={a.slug}
                >
                  <span>{a.category}</span>
                  <h3>{a.title}</h3>
                  <p>{a.audience}</p>
                </a>
              ))}
            </div>
            {!visible.length && (
              <p>一致する記事がありません。別の言葉でもお試しください。</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
