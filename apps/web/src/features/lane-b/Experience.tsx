"use client";

import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Copy,
  FileText,
  History,
  MessageCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ChangeEvent, CompositionEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ScreenKind } from "@/lib/prototype/types";
import {
  glossaryFixtures,
  historyFixtures,
  knowledgeFixtures,
  reviewFixture,
  trainingFixtures,
  transcriptFixture,
  voucherPriceFixtures,
  type HistoryItemFixture,
  type KnowledgeKind,
  type ReviewTone,
  type TranscriptSegmentFixture,
} from "./fixtures";
import styles from "./Experience.module.css";

export function LaneBExperience({ kind }: { kind: ScreenKind }): ReactNode {
  switch (kind) {
    case "transcript":
      return <TranscriptExperience />;
    case "review":
      return <ReviewExperience />;
    case "history":
      return <HistoryExperience />;
    case "knowledge":
      return <KnowledgeExperience />;
    case "reference":
      return <ReferenceExperience />;
    case "training":
      return <TrainingExperience />;
    default:
      return null;
  }
}

function TranscriptExperience() {
  const [segments, setSegments] = useState<TranscriptSegmentFixture[]>(() =>
    transcriptFixture.segments.map((segment) => ({ ...segment })),
  );
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(12);
  const [speed, setSpeed] = useState("1.0");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [conflict, setConflict] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [status, setStatus] = useState("未保存の変更はありません。");

  function updateSegment(id: string, patch: Partial<TranscriptSegmentFixture>) {
    setSegments((current) => current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
    setStatus("未保存の変更があります。");
  }

  function applyPastedText() {
    const lines = pasteDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      setStatus("貼り付けるテキストを入力してください。");
      return;
    }
    setSegments((current) => current.map((segment, index) => (lines[index] ? { ...segment, text: lines[index] } : segment)));
    setPasteOpen(false);
    setStatus(`${Math.min(lines.length, segments.length)}件の発話へテキストを反映しました。内容を確認してください。`);
  }

  function saveDraft() {
    if (conflict) {
      setStatus("別の修正が見つかりました。差分を確認してから保存してください。");
      return;
    }
    setStatus("下書きを保存しました。");
  }

  return (
    <section className={styles.experience} aria-label="文字起こしを確認する">
      <div className={styles.headerButtons}>
          <button className={styles.secondaryButton} type="button" onClick={() => setPasteOpen((open) => !open)}>
            <Copy size={17} aria-hidden="true" />テキスト貼付補助
          </button>
          <button className={styles.secondaryButton} type="button" onClick={() => { setConflict(true); setStatus("別の修正を検知しました。"); }}>
            競合を再現
          </button>
          <button className={styles.primaryButton} type="button" onClick={saveDraft}>下書きを保存</button>
          <Link className={styles.primaryButton} href="/visits/demo/review">確定して振り返りへ<ChevronRight size={17} aria-hidden="true" /></Link>
      </div>

      <div className={styles.audioBar} aria-label="音声再生">
        <button className={styles.roundButton} type="button" aria-label={playing ? "一時停止" : "再生"} onClick={() => setPlaying((value) => !value)}>
          {playing ? <Pause size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" fill="currentColor" />}
        </button>
        <Volume2 size={17} aria-hidden="true" />
        <label className={styles.rangeLabel}>
          <span className={styles.srOnly}>再生位置</span>
          <input type="range" min="0" max="100" value={position} onChange={(event) => setPosition(Number(event.target.value))} />
        </label>
        <span className={styles.timecode}>{playing ? "02:14" : "00:00"} / {transcriptFixture.duration}</span>
        <label className={styles.compactField}>
          <span className={styles.srOnly}>再生速度</span>
          <select value={speed} onChange={(event) => setSpeed(event.target.value)} aria-label="再生速度">
            <option value="0.8">0.8x</option><option value="1.0">1.0x</option><option value="1.2">1.2x</option><option value="1.5">1.5x</option>
          </select>
        </label>
      </div>

      {pasteOpen ? (
        <section className={styles.helperPanel} aria-labelledby="paste-helper-title">
          <div><h3 id="paste-helper-title">テキスト貼付補助</h3><p>一行を一発話として先頭から反映します。反映後に話者と時間を確認してください。</p></div>
          <textarea aria-label="貼り付けるテキスト" rows={4} value={pasteDraft} onChange={(event) => setPasteDraft(event.target.value)} placeholder="発話ごとに改行して貼り付け" />
          <div className={styles.inlineActions}>
            <button className={styles.secondaryButton} type="button" onClick={() => setPasteOpen(false)}>キャンセル</button>
            <button className={styles.primaryButton} type="button" onClick={applyPastedText}>発話区間へ反映</button>
          </div>
        </section>
      ) : null}

      {conflict ? (
        <div className={styles.conflictPanel} role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div><strong>別の修正があります</strong><p>自動上書きはしません。現在の入力を保持したまま差分を確認できます。</p></div>
          <button className={styles.secondaryButton} type="button" onClick={() => setComparing((value) => !value)}>{comparing ? "差分を閉じる" : "最新内容と比較"}</button>
          <button className={styles.iconButton} aria-label="競合通知を閉じる" type="button" onClick={() => { setConflict(false); setComparing(false); }}><X size={18} /></button>
        </div>
      ) : null}
      {comparing ? <div className={styles.diffPanel}><span>現在の入力</span><strong>「金額と根拠をご説明します」</strong><span>最新の保存版</span><strong>「金額の根拠からご説明します」</strong></div> : null}

      <div className={styles.segmentLayout}>
        <div>
          <div className={styles.sectionHeading}><div><h3>発話区間</h3><p>{segments.length}件中、要確認1件</p></div><span className={styles.versionBadge}>版 {transcriptFixture.version}</span></div>
          <ol className={styles.segmentList}>
            {segments.map((segment, index) => (
              <li key={segment.id}>
                <article className={styles.segmentCard} data-review={segment.needsReview || undefined}>
                  <div className={styles.segmentMeta}>
                    <button type="button" className={styles.timeButton} onClick={() => { setPosition(8 + index * 11); setPlaying(true); }} aria-label={`${segment.start}から再生`}>
                      <CirclePlay size={17} aria-hidden="true" />{segment.start}–{segment.end}
                    </button>
                    {segment.needsReview ? <span className={styles.warningBadge}>要確認</span> : <span className={styles.successBadge}>確認済み</span>}
                  </div>
                  <label>話者
                    <select value={segment.speaker} onChange={(event) => updateSegment(segment.id, { speaker: event.target.value as TranscriptSegmentFixture["speaker"] })}>
                      <option value="staff">査定員</option><option value="customer">お客様</option><option value="unknown">不明</option>
                    </select>
                  </label>
                  <label>発話内容
                    <textarea rows={3} value={segment.text} onChange={(event) => updateSegment(segment.id, { text: event.target.value })} />
                  </label>
                </article>
              </li>
            ))}
          </ol>
        </div>
        <aside className={styles.sideNote} aria-label="確認ポイント">
          <h3>確認ポイント</h3>
          <ul><li>話者が正しいか</li><li>固有名詞を伏せられているか</li><li>文意を変えていないか</li></ul>
          <p>文字起こしの修正内容は版として保存し、生成文で上書きしません。</p>
        </aside>
      </div>
      <p className={styles.statusLine} role="status">{status}</p>
    </section>
  );
}

function ReviewExperience() {
  const [selectedId, setSelectedId] = useState(reviewFixture.findings[0].id);
  const [generation, setGeneration] = useState(1);
  const [status, setStatus] = useState("根拠発話を確認してください。");
  const selected = reviewFixture.findings.find((finding) => finding.id === selectedId) ?? reviewFixture.findings[0];
  const toneLabels: Record<ReviewTone, string> = { strength: "良い点", improvement: "改善できる点", advice: "次回の助言" };

  function regenerate() {
    setGeneration((value) => value + 1);
    setStatus("振り返りを再生成しました。既存の版は保持されています。");
  }

  return (
    <section className={styles.experience} aria-label="振り返り結果">
      <div className={styles.headerButtons}>
        <button className={styles.secondaryButton} type="button" onClick={regenerate}><RefreshCw size={17} aria-hidden="true" />振り返りを再生成</button>
      </div>
      <aside className={styles.aiNotice}>
        <Sparkles size={21} aria-hidden="true" />
        <div><strong>AIによる育成支援です</strong><p>根拠発話と照らして確認してください。人事評価や個人の順位付けには使用しません。</p></div>
        <span>生成版 {generation}</span>
      </aside>
      <div className={styles.reviewLayout}>
        <div className={styles.findingColumns}>
          {(["strength", "improvement", "advice"] as ReviewTone[]).map((tone) => (
            <section className={styles.findingGroup} key={tone} aria-labelledby={`review-${tone}`}>
              <h3 id={`review-${tone}`}>{toneLabels[tone]}</h3>
              {reviewFixture.findings.filter((finding) => finding.tone === tone).map((finding) => (
                <button className={styles.findingButton} data-selected={selectedId === finding.id} type="button" key={finding.id} onClick={() => setSelectedId(finding.id)}>
                  <span>{finding.title}</span><small>{finding.body}</small><span className={styles.evidenceLink}>根拠発話を見る<ChevronRight size={15} aria-hidden="true" /></span>
                </button>
              ))}
            </section>
          ))}
        </div>
        <aside className={styles.evidencePane} aria-labelledby="evidence-title">
          <div className={styles.evidenceHeading}><span>根拠発話</span><span>{selected.time}</span></div>
          <h3 id="evidence-title">{selected.title}</h3>
          <blockquote>「{selected.evidence}」</blockquote>
          <p>{selected.body}</p>
          <button className={styles.secondaryButton} type="button" onClick={() => setStatus(`${selected.time}の文字起こしへ移動する操作を選択しました。`)}><CirclePlay size={17} aria-hidden="true" />発話区間を確認</button>
        </aside>
      </div>
      <div className={styles.reviewFooter}>
        <p>内容の正しさを承認する操作ではなく、結果を確認した記録です。</p>
        <button className={styles.primaryButton} type="button" onClick={() => setStatus("確認したことを記録しました。")}><Check size={17} aria-hidden="true" />内容を確認した</button>
        <Link className={styles.secondaryButton} href="/history">履歴を見る<ChevronRight size={17} aria-hidden="true" /></Link>
      </div>
      <p className={styles.statusLine} role="status">{status}</p>
    </section>
  );
}

function HistoryExperience() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("すべて");
  const [selected, setSelected] = useState<HistoryItemFixture | null>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const filtered = historyFixtures.filter((item) => {
    const queryMatch = `${item.label} ${item.theme}`.includes(query.trim());
    const statusMatch = statusFilter === "すべて" || item.status === statusFilter;
    return queryMatch && statusMatch;
  });

  function closeDetail() {
    const id = selected?.id;
    setSelected(null);
    if (id) requestAnimationFrame(() => triggers.current[id]?.focus());
  }

  useEffect(() => {
    if (!selected) return;
    const selectedId = selected.id;
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
        requestAnimationFrame(() => triggers.current[selectedId]?.focus());
        return;
      }
      if (event.key !== "Tab" || !detailRef.current) return;
      const focusable = [...detailRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selected]);

  return (
    <section className={styles.experience} aria-label="訪問と振り返りの履歴">
      <form className={styles.filterBar} role="search" onSubmit={(event) => event.preventDefault()}>
        <label className={styles.searchField}><Search size={18} aria-hidden="true" /><span className={styles.srOnly}>履歴を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="案件ラベル・テーマを検索" /></label>
        <label className={styles.selectField}>状態<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>すべて</option><option>確認待ち</option><option>完了</option><option>一部完了</option></select></label>
        <button className={styles.secondaryButton} type="button" onClick={() => { setQuery(""); setStatusFilter("すべて"); }}><RotateCcw size={16} aria-hidden="true" />条件を戻す</button>
      </form>
      <p className={styles.resultCount} role="status">{filtered.length}件を表示</p>
      {filtered.length ? (
        <ol className={styles.historyList}>
          {filtered.map((item) => (
            <li key={item.id}>
              <article className={styles.historyCard}>
                <time dateTime={item.date}>{item.date.replaceAll("-", "/")}</time>
                <div><h3>{item.label}</h3><p>継続テーマ：{item.theme}</p></div>
                <span className={item.status === "完了" ? styles.successBadge : styles.warningBadge}>{item.status}</span>
                <button ref={(node) => { triggers.current[item.id] = node; }} className={styles.secondaryButton} type="button" onClick={() => setSelected(item)}>{item.nextAction}<ChevronRight size={16} aria-hidden="true" /></button>
              </article>
            </li>
          ))}
        </ol>
      ) : <div className={styles.emptyState}><History size={28} aria-hidden="true" /><h3>一致する履歴はありません</h3><button className={styles.secondaryButton} type="button" onClick={() => { setQuery(""); setStatusFilter("すべて"); }}>条件をクリア</button></div>}
      {selected ? (
        <div className={styles.sheetBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) closeDetail(); }}>
          <aside ref={detailRef} className={styles.detailSheet} role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
            <div className={styles.sheetHandle} aria-hidden="true" />
            <button ref={closeRef} className={styles.iconButton} type="button" aria-label="詳細を閉じる" onClick={closeDetail}><X size={19} /></button>
            <p className={styles.kicker}>{selected.date.replaceAll("-", "/")}・{selected.status}</p>
            <h3 id="history-detail-title">{selected.label}</h3>
            <p>{selected.detail}</p>
            <dl className={styles.detailList}><div><dt>継続テーマ</dt><dd>{selected.theme}</dd></div><div><dt>次の操作</dt><dd>{selected.nextAction}</dd></div></dl>
            <Link className={styles.primaryButton} href="/visits/demo/review">振り返りを開く<ChevronRight size={17} aria-hidden="true" /></Link>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

function KnowledgeExperience() {
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | KnowledgeKind>("all");
  const [selectedId, setSelectedId] = useState(knowledgeFixtures[0].id);
  const composing = useRef(false);
  const kindOptions: { id: "all" | KnowledgeKind; label: string }[] = [
    { id: "all", label: "すべて" }, { id: "talk", label: "トーク" }, { id: "flow", label: "接客フロー" }, { id: "manual", label: "マニュアル" }, { id: "legal", label: "法務" },
  ];

  function changeQuery(event: ChangeEvent<HTMLInputElement>) {
    setDraftQuery(event.target.value);
    if (!composing.current) setQuery(event.target.value);
  }

  function endComposition(event: CompositionEvent<HTMLInputElement>) {
    composing.current = false;
    setDraftQuery(event.currentTarget.value);
    setQuery(event.currentTarget.value);
  }

  const normalized = query.trim().toLocaleLowerCase("ja-JP");
  const results = knowledgeFixtures.filter((item) => {
    const kindMatch = kind === "all" || item.kind === kind;
    const haystack = `${item.title} ${item.summary} ${item.keywords.join(" ")}`.toLocaleLowerCase("ja-JP");
    return kindMatch && (!normalized || haystack.includes(normalized));
  });
  const selected = results.find((item) => item.id === selectedId) ?? results[0] ?? null;

  return (
    <section className={styles.experience} aria-label="トーク・接客フローを探す">
      <form className={styles.knowledgeSearch} role="search" onSubmit={(event) => { event.preventDefault(); setQuery(draftQuery); }}>
        <label className={styles.searchField}><Search size={18} aria-hidden="true" /><span className={styles.srOnly}>現場の知識を検索</span><input value={draftQuery} onChange={changeQuery} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={endComposition} placeholder="例：比較、クーリングオフ" /></label>
        <button className={styles.primaryButton} type="submit">検索</button>
      </form>
      <div className={styles.segmentedControl} role="group" aria-label="コンテンツ種別">
        {kindOptions.map((option) => <button type="button" data-active={kind === option.id} aria-pressed={kind === option.id} key={option.id} onClick={() => setKind(option.id)}>{option.label}</button>)}
      </div>
      <p className={styles.resultCount} role="status">{results.length}件・承認済みの現行版</p>
      <div className={styles.knowledgeLayout}>
        <ul className={styles.resultList} aria-label="検索結果">
          {results.map((item) => (
            <li key={item.id}><button type="button" data-selected={selected?.id === item.id} onClick={() => setSelectedId(item.id)}><span className={styles.kindBadge}>{item.kindLabel}</span><strong>{item.title}</strong><small>{item.summary}</small><span className={styles.evidenceLink}>版 {item.version}・{item.effective}<ChevronRight size={15} aria-hidden="true" /></span></button></li>
          ))}
          {!results.length ? <li className={styles.noResult}>条件に一致する承認済みコンテンツはありません。</li> : null}
        </ul>
        {selected ? (
          <article className={styles.knowledgeDetail}>
            <div className={styles.detailMeta}><span className={styles.kindBadge}>{selected.kindLabel}</span><span>現行版 {selected.version}</span><time dateTime={selected.effective}>適用 {selected.effective}</time></div>
            <h3>{selected.title}</h3><p>{selected.summary}</p>
            {selected.kind === "legal" ? <aside className={styles.legalNotice}><Scale size={18} aria-hidden="true" /><span>承認済みの注意事項です。判断が必要な場合は責任者へ確認してください。</span></aside> : null}
            <ol className={styles.structuredSteps}>{selected.body.map((line) => <li key={line}>{line}</li>)}</ol>
            <div className={styles.inlineActions}><button className={styles.secondaryButton} type="button">承認済み文をコピー</button><button className={styles.secondaryButton} type="button">関連を見る</button></div>
          </article>
        ) : <div className={styles.emptyState}><BookOpen size={28} aria-hidden="true" /><h3>表示できる内容がありません</h3></div>}
      </div>
    </section>
  );
}

function ReferenceExperience() {
  const [tab, setTab] = useState<"glossary" | "price">("glossary");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<{ title: string; source: string } | null>(null);
  const glossary = glossaryFixtures.filter((item) => `${item.term} ${item.definition} ${item.related.join(" ")}`.includes(query));
  const prices = voucherPriceFixtures.filter((item) => `${item.name} ${item.issuer} ${item.conditions}`.includes(query));

  return (
    <section className={styles.experience} aria-label="用語・金券価格">
      <form className={styles.knowledgeSearch} role="search" onSubmit={(event) => event.preventDefault()}>
        <label className={styles.searchField}><Search size={18} aria-hidden="true" /><span className={styles.srOnly}>用語・金券価格を検索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "glossary" ? "用語を検索" : "金券名・発行元を検索"} /></label>
      </form>
      <div className={styles.tabList} role="tablist" aria-label="参照情報の種別">
        <button type="button" role="tab" aria-selected={tab === "glossary"} data-active={tab === "glossary"} onClick={() => setTab("glossary")}>用語</button>
        <button type="button" role="tab" aria-selected={tab === "price"} data-active={tab === "price"} onClick={() => setTab("price")}>金券価格</button>
      </div>
      {tab === "glossary" ? (
        <div className={styles.referenceGrid} role="tabpanel" aria-label="用語">
          {glossary.map((item) => <article className={styles.referenceCard} key={item.id}><span className={styles.kindBadge}>用語</span><h3>{item.term}</h3><p>{item.definition}</p><dl><div><dt>関連</dt><dd>{item.related.join("・")}</dd></div><div><dt>版</dt><dd>{item.version}</dd></div></dl><button className={styles.secondaryButton} type="button" onClick={() => setSource({ title: item.term, source: item.source })}>根拠と版を確認</button></article>)}
        </div>
      ) : (
        <div role="tabpanel" aria-label="金券価格">
          <aside className={styles.priceNotice}><AlertTriangle size={18} aria-hidden="true" /><span>表示値は承認済み価格表の参考値です。実品の状態を確認し、確定査定額として扱わないでください。</span></aside>
          <div className={styles.priceTableWrap}>
            <table className={styles.priceTable}>
              <caption>金券価格表・有効日と条件を含む</caption>
              <thead><tr><th>金券</th><th>発行元</th><th>参考値</th><th>単位</th><th>条件</th><th>有効日</th><th><span className={styles.srOnly}>操作</span></th></tr></thead>
              <tbody>{prices.map((item) => <tr key={item.id}><th scope="row">{item.name}</th><td>{item.issuer}</td><td><strong>{item.referenceValue}</strong></td><td>{item.unit}</td><td>{item.conditions}</td><td>{item.effective}</td><td><button className={styles.textButton} type="button" onClick={() => setSource({ title: item.name, source: item.source })}>根拠</button></td></tr>)}</tbody>
            </table>
          </div>
          <div className={styles.priceCards} aria-label="金券価格カード">
            {prices.map((item) => <article key={item.id}><h3>{item.name}</h3><strong>{item.referenceValue}</strong><dl><div><dt>発行元</dt><dd>{item.issuer}</dd></div><div><dt>単位</dt><dd>{item.unit}</dd></div><div><dt>条件</dt><dd>{item.conditions}</dd></div><div><dt>有効日</dt><dd>{item.effective}</dd></div></dl><button className={styles.secondaryButton} type="button" onClick={() => setSource({ title: item.name, source: item.source })}>根拠と版を確認</button></article>)}
          </div>
        </div>
      )}
      {source ? <aside className={styles.sourcePanel} role="status"><FileText size={19} aria-hidden="true" /><div><strong>{source.title}</strong><p>{source.source}。承認済みの現行版を表示しています。</p></div><button className={styles.iconButton} aria-label="根拠を閉じる" type="button" onClick={() => setSource(null)}><X size={18} /></button></aside> : null}
    </section>
  );
}

function TrainingExperience() {
  const [tab, setTab] = useState<"roleplay" | "video" | "history">("roleplay");
  const [scenarioId, setScenarioId] = useState(trainingFixtures.scenarios[0].id);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string>(trainingFixtures.videos[0].id);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const scenario = trainingFixtures.scenarios.find((item) => item.id === scenarioId) ?? trainingFixtures.scenarios[0];
  const choice = scenario.choices.find((item) => item.id === choiceId) ?? null;
  const video = trainingFixtures.videos.find((item) => item.id === videoId) ?? trainingFixtures.videos[0];

  function chooseScenario(id: string) {
    setScenarioId(id);
    setChoiceId(null);
  }

  return (
    <section className={styles.experience} aria-label="ロールプレイ・研修">
      <div className={styles.tabList} role="tablist" aria-label="研修種別">
        <button type="button" role="tab" aria-selected={tab === "roleplay"} data-active={tab === "roleplay"} onClick={() => setTab("roleplay")}><MessageCircle size={17} aria-hidden="true" />ロールプレイ</button>
        <button type="button" role="tab" aria-selected={tab === "video"} data-active={tab === "video"} onClick={() => setTab("video")}><CirclePlay size={17} aria-hidden="true" />動画</button>
        <button type="button" role="tab" aria-selected={tab === "history"} data-active={tab === "history"} onClick={() => setTab("history")}><Clock3 size={17} aria-hidden="true" />履歴</button>
      </div>
      {tab === "roleplay" ? (
        <div className={styles.trainingLayout} role="tabpanel" aria-label="ロールプレイ">
          <aside className={styles.scenarioList}><h3>シナリオ</h3>{trainingFixtures.scenarios.map((item) => <button type="button" data-selected={scenario.id === item.id} key={item.id} onClick={() => chooseScenario(item.id)}><strong>{item.title}</strong><small>{item.objective}</small></button>)}</aside>
          <section className={styles.roleplayPanel} aria-labelledby="scenario-title">
            <p className={styles.kicker}>録音なし</p><h3 id="scenario-title">{scenario.title}</h3><p>{scenario.objective}</p>
            <div className={styles.chatBubble} data-speaker="customer"><span>お客様</span><p>{scenario.customerMessage}</p></div>
            <fieldset className={styles.choiceList}><legend>返答を選ぶ</legend>{scenario.choices.map((item) => <label key={item.id} data-selected={choiceId === item.id}><input type="radio" name="training-choice" checked={choiceId === item.id} onChange={() => setChoiceId(item.id)} /><span>{item.label}</span></label>)}</fieldset>
            {choice ? <div className={choice.recommended ? styles.positiveFeedback : styles.guidanceFeedback} role="status"><strong>{choice.recommended ? "良い組み立てです" : "別の伝え方を試しましょう"}</strong><p>{choice.feedback}</p></div> : <p className={styles.fieldHint}>返答を選ぶと、承認済みの学習ポイントを表示します。</p>}
            <label className={styles.noteField}>自分用メモ<textarea rows={3} placeholder="次回試したい言い方を記録" /></label>
          </section>
        </div>
      ) : null}
      {tab === "video" ? (
        <div className={styles.trainingLayout} role="tabpanel" aria-label="研修動画">
          <aside className={styles.scenarioList}><h3>研修動画</h3>{trainingFixtures.videos.map((item) => <button type="button" data-selected={video.id === item.id} key={item.id} onClick={() => { setVideoId(item.id); setVideoPlaying(false); }}><strong>{item.title}</strong><small>{item.duration}・字幕あり</small></button>)}</aside>
          <section className={styles.videoPanel} aria-labelledby="video-title">
            <div className={styles.videoPoster}><button className={styles.videoPlay} type="button" aria-label={videoPlaying ? "動画を一時停止" : "動画を再生"} onClick={() => setVideoPlaying((value) => !value)}>{videoPlaying ? <CirclePause size={42} aria-hidden="true" /> : <CirclePlay size={42} aria-hidden="true" />}</button><span>{videoPlaying ? "再生中 00:24" : video.duration}</span></div>
            <h3 id="video-title">{video.title}</h3><p>{video.description}</p>
            <div className={styles.videoMeta}><span>字幕あり</span><span>文字版あり</span><span>承認版 1</span></div>
            <details><summary>文字版を読む</summary><p>所属と氏名、訪問目的、所要時間を順に伝え、お客様が質問できる間を取ります。</p></details>
          </section>
        </div>
      ) : null}
      {tab === "history" ? (
        <div role="tabpanel" aria-label="自分の研修履歴">
          <aside className={styles.trainingNotice}>各シナリオの現在の進捗だけを表示します。他の利用者との比較や点数表示はありません。</aside>
          <ol className={styles.learningHistory}>{trainingFixtures.history.map((item) => <li key={item.id}><article><time dateTime={item.updated}>{item.updated.replaceAll("-", "/")}</time><div><h3>{item.title}</h3><p>次に試すこと：{item.next}</p></div><span className={item.status === "完了" ? styles.successBadge : styles.warningBadge}>{item.status}</span><button className={styles.secondaryButton} type="button">{item.status === "完了" ? "もう一度練習" : "続きから"}</button></article></li>)}</ol>
        </div>
      ) : null}
    </section>
  );
}
