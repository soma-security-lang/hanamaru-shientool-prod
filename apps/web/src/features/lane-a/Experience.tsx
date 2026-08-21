"use client";

import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  FileAudio,
  FileCheck2,
  FileText,
  Filter,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import type { ScreenKind } from "@/lib/prototype/types";
import {
  extractionFieldFixtures,
  homeAnswers,
  homeQuestions,
  initialJobEvents,
  visitFixtures,
  type ExtractionFieldFixture,
  type JobEventFixture,
  type VisitStatus,
} from "./fixtures";
import styles from "./Experience.module.css";

const allStatuses: Array<VisitStatus | "すべて"> = [
  "すべて",
  "準備中",
  "文字起こし中",
  "確認待ち",
  "完了",
];

function PrimaryButton({ children, disabled = false, onClick, type = "button" }: { children: ReactNode; disabled?: boolean; onClick?: () => void; type?: "button" | "submit" }) {
  return <button className={styles.primaryButton} disabled={disabled} onClick={onClick} type={type}>{children}</button>;
}

function SecondaryButton({ children, disabled = false, onClick, type = "button" }: { children: ReactNode; disabled?: boolean; onClick?: () => void; type?: "button" | "submit" }) {
  return <button className={styles.secondaryButton} disabled={disabled} onClick={onClick} type={type}>{children}</button>;
}

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "warning" | "danger" }) {
  return <span className={styles.statusPill} data-tone={tone}>{children}</span>;
}

function LoginExperience() {
  const [status, setStatus] = useState<"initial" | "complete">("initial");
  const router = useRouter();

  return <section className={styles.loginStage} aria-labelledby="lane-a-login-title">
    <div className={styles.loginCard}>
      <div className={styles.iconTile}><ShieldCheck aria-hidden="true" size={24} /></div>
      <h1 id="lane-a-login-title">ログイン</h1>
      {status === "complete" ? <div className={styles.successNotice} role="status"><Check aria-hidden="true" size={18} />ログインしました。</div> : null}
      <PrimaryButton onClick={() => { setStatus("complete"); router.push("/"); }}><LockKeyhole aria-hidden="true" size={18} />Googleでログイン</PrimaryButton>
      <nav className={styles.inlineLinks} aria-label="利用前の案内">
        <a href="#privacy">個人情報とAIの取扱い</a>
        <a href="#support">ログインのヘルプ</a>
      </nav>
    </div>
  </section>;
}

function HomeExperience() {
  const [question, setQuestion] = useState<string>(homeQuestions[0]);
  const [answer, setAnswer] = useState("");
  const router = useRouter();

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (!normalized) return;
    const preset = homeQuestions.find((item) => item === normalized);
    setAnswer(preset ? homeAnswers[preset] : "承認済みコンテンツを検索しました。具体的な案件判断は、原本と運用ルールを確認してください。");
  }

  return <div className={styles.stack}>
    <section className={styles.nextAction} aria-labelledby="next-action-title">
      <div>
        <p className={styles.eyebrow}>次に行うこと</p>
        <h2 id="next-action-title">13:30の訪問資料を確認</h2>
        <p>品物カテゴリを原本と照合すると、訪問準備を確定できます。</p>
      </div>
      <PrimaryButton onClick={() => router.push("/visits/demo/document")}>PDF確認へ<ArrowRight aria-hidden="true" size={18} /></PrimaryButton>
    </section>

    <section className={styles.summaryGrid} aria-label="今日の業務概要">
      <article><span>今日の訪問</span><strong>3件</strong><small>次は13:30</small></article>
      <article><span>処理中</span><strong>2件</strong><small>抽出・文字起こし</small></article>
      <article><span>確認待ち</span><strong>1件</strong><small>振り返り</small></article>
    </section>

    <div className={styles.twoColumn}>
      <section className={styles.surface} aria-labelledby="today-title">
        <header className={styles.sectionHeader}><div><h2 id="today-title">今日の訪問</h2></div><Link href="/visits">すべて見る</Link></header>
        <ul className={styles.actionList}>
          {visitFixtures.slice(0, 3).map((visit) => <li key={visit.id}><div><strong>{visit.scheduledAt.slice(11, 16)}・{visit.label}</strong><span>{visit.nextAction}</span></div><StatusPill tone={visit.status === "文字起こし中" ? "accent" : visit.status === "確認待ち" ? "warning" : "neutral"}>{visit.status}</StatusPill><Link aria-label={`${visit.label}を開く`} href={`/visits/${visit.id}/edit`}><ChevronRight aria-hidden="true" size={18} /></Link></li>)}
        </ul>
      </section>

      <section className={styles.aiPanel} aria-labelledby="ai-question-title">
        <header><div className={styles.iconTile}><Sparkles aria-hidden="true" size={21} /></div><div><p className={styles.eyebrow}>承認済みコンテンツ</p><h2 id="ai-question-title">AI支援に質問</h2></div></header>
        <div className={styles.quickQuestions} aria-label="質問例">
          {homeQuestions.map((item) => <button key={item} onClick={() => setQuestion(item)} type="button">{item}</button>)}
        </div>
        <form className={styles.aiForm} onSubmit={ask}>
          <label htmlFor="lane-a-question">質問</label>
          <div><input id="lane-a-question" maxLength={200} onChange={(event) => setQuestion(event.target.value)} value={question} /><PrimaryButton type="submit">質問する</PrimaryButton></div>
        </form>
        {answer ? <div className={styles.aiAnswer} role="status"><strong>回答</strong><p>{answer}</p><small>根拠：接客フロー v1.2 ／ 最終確認 2026-08-01</small></div> : <p className={styles.muted}>AI回答は育成支援です。案件判断は原本・ルールを優先します。</p>}
      </section>
    </div>
  </div>;
}

function VisitListExperience() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<VisitStatus | "すべて">("すべて");
  const [filterOpen, setFilterOpen] = useState(false);
  const router = useRouter();

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    return visitFixtures.filter((visit) => {
      const matchesQuery = !normalized || [visit.caseNumber, visit.label, visit.branch, visit.assignee].some((value) => value.toLocaleLowerCase("ja").includes(normalized));
      return matchesQuery && (status === "すべて" || visit.status === status);
    });
  }, [query, status]);

  return <section className={styles.stack} aria-labelledby="visit-results-title">
    <form className={styles.searchBar} role="search" onSubmit={(event) => event.preventDefault()}>
      <div className={styles.searchField}><Search aria-hidden="true" size={19} /><label className={styles.srOnly} htmlFor="visit-query">案件を検索</label><input id="visit-query" onChange={(event) => setQuery(event.target.value)} placeholder="案件番号・訪問先・担当を検索" type="search" value={query} /></div>
      <SecondaryButton onClick={() => setFilterOpen((current) => !current)}><Filter aria-hidden="true" size={18} />フィルター{status !== "すべて" ? " 1" : ""}</SecondaryButton>
      <PrimaryButton onClick={() => router.push("/visits/new")}>新しい案件</PrimaryButton>
    </form>

    {filterOpen ? <div className={styles.filterSheet} role="region" aria-label="案件フィルター">
      <div><strong>状態で絞り込み</strong><button aria-label="フィルターを閉じる" onClick={() => setFilterOpen(false)} type="button">閉じる</button></div>
      <div className={styles.chips}>{allStatuses.map((item) => <button aria-pressed={status === item} data-active={status === item} key={item} onClick={() => setStatus(item)} type="button">{item}</button>)}</div>
    </div> : null}

    <div className={styles.resultHeader}><div><p className={styles.eyebrow}>検索結果</p><h2 id="visit-results-title">訪問案件</h2></div><output aria-live="polite">{results.length}件</output></div>

    {results.length ? <>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <caption>訪問案件一覧。予定日時が新しい順。</caption>
          <thead><tr><th scope="col">案件</th><th scope="col">訪問予定</th><th scope="col">担当</th><th scope="col">状態</th><th scope="col">次の操作</th></tr></thead>
          <tbody>{results.map((visit) => <tr key={visit.id}><th scope="row"><Link href={`/visits/${visit.id}/edit`}>{visit.caseNumber}</Link><small>{visit.label}</small></th><td>{visit.scheduledAt.slice(0, 16).replace("T", " ")}</td><td>{visit.assignee}<small>{visit.branch}</small></td><td><StatusPill tone={visit.status === "完了" ? "success" : visit.status === "確認待ち" ? "warning" : visit.status === "文字起こし中" ? "accent" : "neutral"}>{visit.status}</StatusPill></td><td><Link href={`/visits/${visit.id}/edit`}>{visit.nextAction}<ChevronRight aria-hidden="true" size={16} /></Link></td></tr>)}</tbody>
        </table>
      </div>
      <ul className={styles.visitCards} aria-label="訪問案件一覧">{results.map((visit) => <li key={visit.id}><div><span>{visit.caseNumber}</span><StatusPill tone={visit.status === "完了" ? "success" : visit.status === "確認待ち" ? "warning" : visit.status === "文字起こし中" ? "accent" : "neutral"}>{visit.status}</StatusPill></div><h3><Link href={`/visits/${visit.id}/edit`}>{visit.label}</Link></h3><dl><div><dt>訪問</dt><dd>{visit.scheduledAt.slice(5, 16).replace("T", " ")}</dd></div><div><dt>担当</dt><dd>{visit.assignee}</dd></div></dl><Link className={styles.cardAction} href={`/visits/${visit.id}/edit`}>{visit.nextAction}<ChevronRight aria-hidden="true" size={17} /></Link></li>)}</ul>
    </> : <div className={styles.emptyState}><Search aria-hidden="true" size={30} /><h3>条件に一致する案件はありません</h3><p>検索語または状態フィルターを変更してください。</p><SecondaryButton onClick={() => { setQuery(""); setStatus("すべて"); }}>条件をクリア</SecondaryButton></div>}
  </section>;
}

interface VisitFormValues {
  caseNumber: string;
  scheduledAt: string;
  branch: string;
  assignee: string;
  label: string;
  note: string;
}

function VisitFormExperience() {
  const [values, setValues] = useState<VisitFormValues>({ caseNumber: "DEMO-0811-05", scheduledAt: "2026-08-11T15:30", branch: "tokyo-central", assignee: "self", label: "訪問先E", note: "本人確認書類を当日確認（匿名メモ）" });
  const [errors, setErrors] = useState<Partial<Record<keyof VisitFormValues, string>>>({});
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  function update<K extends keyof VisitFormValues>(key: K, value: VisitFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSaved(false);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Partial<Record<keyof VisitFormValues, string>> = {};
    if (!values.caseNumber.trim()) nextErrors.caseNumber = "案件番号を入力してください。";
    if (!values.scheduledAt) nextErrors.scheduledAt = "訪問予定日時を入力してください。";
    if (!values.branch) nextErrors.branch = "担当店舗を選択してください。";
    if (!values.assignee) nextErrors.assignee = "担当者を選択してください。";
    setErrors(nextErrors);
    const valid = Object.keys(nextErrors).length === 0;
    setSaved(valid);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (valid && submitter?.value === "next") router.push("/visits/demo/document");
  }

  return <form className={styles.formExperience} onSubmit={save} noValidate>
    {Object.keys(errors).length ? <div className={styles.errorSummary} role="alert" tabIndex={-1}><AlertCircle aria-hidden="true" size={19} /><div><strong>入力内容を確認してください</strong><p>{Object.values(errors).filter(Boolean).join(" ")}</p></div></div> : null}
    {saved ? <div className={styles.successNotice} role="status"><Check aria-hidden="true" size={18} />案件を保存しました。</div> : null}
    <fieldset>
      <legend>案件の識別</legend>
      <p>訪問準備で共通して使う最小情報です。</p>
      <div className={styles.formGrid}>
        <label>案件番号<span>必須</span><input aria-invalid={Boolean(errors.caseNumber)} onChange={(event) => update("caseNumber", event.target.value)} value={values.caseNumber} />{errors.caseNumber ? <small className={styles.fieldError}>{errors.caseNumber}</small> : null}</label>
        <label>訪問先ラベル<input maxLength={200} onChange={(event) => update("label", event.target.value)} value={values.label} /><small>個人を特定できる情報は入力しないでください。</small></label>
      </div>
    </fieldset>
    <fieldset>
      <legend>予定と担当</legend>
      <div className={styles.formGrid}>
        <label>訪問予定日時<span>必須</span><input aria-invalid={Boolean(errors.scheduledAt)} onChange={(event) => update("scheduledAt", event.target.value)} type="datetime-local" value={values.scheduledAt} />{errors.scheduledAt ? <small className={styles.fieldError}>{errors.scheduledAt}</small> : <small>Asia/Tokyo</small>}</label>
        <label>担当店舗<span>必須</span><select aria-invalid={Boolean(errors.branch)} onChange={(event) => update("branch", event.target.value)} value={values.branch}><option value="tokyo-central">東京中央店</option><option value="tokyo-west">東京西店</option></select>{errors.branch ? <small className={styles.fieldError}>{errors.branch}</small> : null}</label>
        <label>担当者<span>必須</span><select aria-invalid={Boolean(errors.assignee)} onChange={(event) => update("assignee", event.target.value)} value={values.assignee}><option value="self">山田（自分）</option><option value="member-demo-02">佐藤</option></select>{errors.assignee ? <small className={styles.fieldError}>{errors.assignee}</small> : null}</label>
      </div>
    </fieldset>
    <fieldset>
      <legend>訪問メモ</legend>
      <label>匿名メモ<textarea maxLength={4000} onChange={(event) => update("note", event.target.value)} rows={4} value={values.note} /><small>{values.note.length} / 4000文字。個人を直接特定する情報は入力しません。</small></label>
    </fieldset>
    <footer className={styles.formActions}><SecondaryButton onClick={() => router.push("/visits")}>キャンセル</SecondaryButton><SecondaryButton type="submit">下書き保存</SecondaryButton><button className={styles.primaryButton} type="submit" value="next">保存してPDFへ<ArrowRight aria-hidden="true" size={18} /></button></footer>
  </form>;
}

function DocumentExperience() {
  const [fields, setFields] = useState<ExtractionFieldFixture[]>(extractionFieldFixtures);
  const [selectedId, setSelectedId] = useState(extractionFieldFixtures[1].id);
  const [notice, setNotice] = useState("");
  const selected = fields.find((field) => field.id === selectedId) ?? fields[0];
  const unresolved = fields.filter((field) => field.verification === "unverified").length;
  const router = useRouter();

  function updateValue(value: string) {
    setFields((current) => current.map((field) => field.id === selectedId ? { ...field, value, verification: "corrected" } : field));
    setNotice("");
  }

  function confirmSelected() {
    setFields((current) => current.map((field) => field.id === selectedId ? { ...field, verification: "confirmed" } : field));
    setNotice(`${selected.label}を確認済みにしました。`);
  }

  return <section className={styles.documentExperience} aria-labelledby="document-review-title">
    <header className={styles.documentSummary}><div><p className={styles.eyebrow}>匿名化された訪問情報.pdf</p><h2 id="document-review-title">原本と抽出結果を照合</h2><p>選択した項目の根拠ページと抜粋を確認してから確定します。</p></div><div><StatusPill tone={unresolved ? "warning" : "success"}>要確認 {unresolved}件</StatusPill><StatusPill>全4頁</StatusPill></div></header>
    {notice ? <div className={styles.successNotice} role="status"><Check aria-hidden="true" size={18} />{notice}</div> : null}
    <div className={styles.documentWorkspace}>
      <section className={styles.pdfPane} aria-labelledby="pdf-pane-title">
        <div className={styles.paneToolbar}><div><FileText aria-hidden="true" size={19} /><strong id="pdf-pane-title">PDF原本</strong></div><span>ページ {selected.page} / 4</span></div>
        <div className={styles.pdfPage}>
          <span>匿名サンプル・PAGE {selected.page}</span>
          <h3>{selected.page === 1 ? "訪問概要" : selected.page === 2 ? "品物情報" : "注意事項"}</h3>
          <p>PDF原本の該当ページを表示します。</p>
          <mark>{selected.excerpt}</mark>
        </div>
        <div className={styles.evidenceText}><strong>選択項目の根拠</strong><p>{selected.excerpt}</p><small>ページ {selected.page} ／ 抽出確度 {Math.round(selected.confidence * 100)}%</small></div>
      </section>
      <section className={styles.fieldPane} aria-labelledby="field-pane-title">
        <div className={styles.paneToolbar}><strong id="field-pane-title">抽出項目</strong><span>{fields.length}件</span></div>
        <ul className={styles.fieldList} aria-label="抽出項目">
          {fields.map((field) => <li key={field.id}><button aria-current={field.id === selectedId} className={styles.fieldItem} data-active={field.id === selectedId} onClick={() => { setSelectedId(field.id); setNotice(""); }} type="button"><span><strong>{field.label}</strong><small>ページ {field.page}・確度 {Math.round(field.confidence * 100)}%</small></span><StatusPill tone={field.verification === "confirmed" ? "success" : field.verification === "corrected" ? "accent" : "warning"}>{field.verification === "confirmed" ? "確認済み" : field.verification === "corrected" ? "修正済み" : "要確認"}</StatusPill></button></li>)}
        </ul>
        <div className={styles.fieldEditor}>
          <label htmlFor="extraction-value">{selected.label}</label>
          <input id="extraction-value" onChange={(event) => updateValue(event.target.value)} value={selected.value} />
          <p><CircleHelp aria-hidden="true" size={16} />値を修正しても、原本の根拠は変更されません。</p>
          <div><SecondaryButton onClick={() => setNotice("根拠ページを表示しています。")}>根拠を見る</SecondaryButton><PrimaryButton onClick={confirmSelected}>この項目を確認</PrimaryButton></div>
        </div>
      </section>
    </div>
    <footer className={styles.workspaceActions}><span>{unresolved ? `残り${unresolved}件を確認してください。` : "すべての項目を確認しました。"}</span><PrimaryButton disabled={unresolved > 0} onClick={() => router.push("/visits/demo/recording")}>確定して音声登録へ<ArrowRight aria-hidden="true" size={18} /></PrimaryButton></footer>
  </section>;
}

function RecordingExperience() {
  const [acknowledged, setAcknowledged] = useState(false);
  const [consentRecorded, setConsentRecorded] = useState(false);
  const [source, setSource] = useState<"file" | "drive">("file");
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("");
  const router = useRouter();

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setFileName(event.currentTarget.files?.[0]?.name ?? "");
    setStatus("");
  }

  function importRecording() {
    if (!consentRecorded || !fileName) return;
    setStatus(`${source === "file" ? "音声ファイル" : "Driveの音声"}を取り込みました。`);
    router.push("/visits/demo/transcription/status");
  }

  return <section className={styles.recordingExperience} aria-labelledby="consent-title">
    <div className={styles.consentCard}>
      <div className={styles.iconTile}><ShieldCheck aria-hidden="true" size={22} /></div>
      <div className={styles.consentCopy}><p className={styles.eyebrow}>STEP 1</p><h2 id="consent-title">録音同意を記録</h2><p>録音の目的、閲覧者、保存期間の初期案を説明したうえで、了承の事実だけを記録します。</p><a href="#notice">説明文 v0.1（法務承認前）を確認</a></div>
      <label className={styles.consentCheck}><input checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} type="checkbox" /><span><strong>説明し、了承を得たことを確認しました</strong><small>file選択だけを同意とはみなしません。</small></span></label>
      <PrimaryButton disabled={!acknowledged || consentRecorded} onClick={() => setConsentRecorded(true)}>{consentRecorded ? <><Check aria-hidden="true" size={18} />同意を記録済み</> : "同意を記録"}</PrimaryButton>
      <button className={styles.textButton} onClick={() => { setAcknowledged(false); setConsentRecorded(false); router.push("/visits/demo/transcript"); }} type="button">録音せず文字入力へ</button>
    </div>

    <div className={styles.importCard} aria-disabled={!consentRecorded}>
      <div className={styles.importHeader}><div><p className={styles.eyebrow}>STEP 2</p><h2>音声を取り込む</h2></div>{consentRecorded ? <StatusPill tone="success">同意確認済み</StatusPill> : <StatusPill tone="warning">同意確認前</StatusPill>}</div>
      <div className={styles.sourceTabs} role="group" aria-label="音声の取込方法">
        <button aria-pressed={source === "file"} data-active={source === "file"} disabled={!consentRecorded} onClick={() => { setSource("file"); setFileName(""); setStatus(""); }} type="button"><UploadCloud aria-hidden="true" size={19} />この端末のファイル</button>
        <button aria-pressed={source === "drive"} data-active={source === "drive"} disabled={!consentRecorded} onClick={() => { setSource("drive"); setFileName(""); setStatus(""); }} type="button"><FolderOpen aria-hidden="true" size={19} />Google Drive</button>
      </div>
      {source === "file" ? <label className={styles.filePicker} data-disabled={!consentRecorded}><FileAudio aria-hidden="true" size={30} /><strong>{fileName || "音声ファイルを選択"}</strong><span>M4A / MP3 / WAV・正式上限は確認中</span><input accept="audio/*,.m4a,.mp3,.wav" disabled={!consentRecorded} onChange={selectFile} type="file" /></label> : <div className={styles.drivePicker}><FolderOpen aria-hidden="true" size={30} /><strong>{fileName || "Driveから音声を選択"}</strong><p>Drive内の音声ファイルを選択してください。</p><SecondaryButton disabled={!consentRecorded} onClick={() => setFileName("訪問録音_001.m4a")}>Driveを開く</SecondaryButton></div>}
      {fileName ? <div className={styles.selectedFile}><div><FileCheck2 aria-hidden="true" size={20} /><span><strong>{fileName}</strong><small>30分00秒</small></span></div><button aria-label="選択した音声を外す" onClick={() => { setFileName(""); setStatus(""); }} type="button">選択解除</button></div> : null}
      <div className={styles.importActions}><p>取込後もこのページを前面に保つ必要はありません。</p><PrimaryButton disabled={!consentRecorded || !fileName} onClick={importRecording}>音声を取り込む</PrimaryButton></div>
    </div>
    {status ? <div className={status.includes("取り込みました") ? styles.successNotice : styles.infoNotice} role="status">{status.includes("取り込みました") ? <Check aria-hidden="true" size={18} /> : <CircleHelp aria-hidden="true" size={18} />}{status}</div> : null}
  </section>;
}

type JobState = "retry_wait" | "running" | "succeeded";

function JobExperience() {
  const [state, setState] = useState<JobState>("retry_wait");
  const [events, setEvents] = useState<JobEventFixture[]>(initialJobEvents);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  function retry() {
    setState("running");
    setEvents((current) => [...current.map((event) => event.tone === "current" ? { ...event, tone: "complete" as const } : event), { id: `retry-${current.length}`, label: "再試行中", at: "14:15", detail: "文字起こし処理を再開しました", tone: "current" }]);
  }

  function refresh() {
    if (state === "running") {
      setState("succeeded");
      setEvents((current) => [...current.map((event) => event.tone === "current" ? { ...event, tone: "complete" as const } : event), { id: "completed", label: "完了", at: "14:18", detail: "文字起こし結果を確認できます", tone: "current" }]);
    }
  }

  const stateLabel = state === "retry_wait" ? "自動再試行待ち" : state === "running" ? "処理中" : "完了";

  return <section className={styles.jobExperience} aria-labelledby="job-status-title">
    <div className={styles.jobHero} data-state={state}>
      <div className={styles.jobIcon}>{state === "running" ? <LoaderCircle aria-hidden="true" className={styles.spinner} size={26} /> : state === "succeeded" ? <Check aria-hidden="true" size={26} /> : <Clock3 aria-hidden="true" size={26} />}</div>
      <div><h2 id="job-status-title">{stateLabel}</h2><p>{state === "retry_wait" ? "一時的な混雑のため14:15に再試行します。ページを閉じても処理は続きます。" : state === "running" ? "音声を安全に処理しています。進捗率を推測表示しません。" : "文字起こしが完了しました。内容を確認してから振り返りへ進んでください。"}</p></div>
      <div className={styles.jobActions}>
        {state === "retry_wait" ? <PrimaryButton onClick={retry}><RefreshCw aria-hidden="true" size={18} />今すぐ再試行</PrimaryButton> : null}
        {state === "running" ? <SecondaryButton onClick={refresh}>状態を更新</SecondaryButton> : null}
        {state === "succeeded" ? <PrimaryButton onClick={() => router.push("/visits/demo/transcript")}>文字起こしを確認<ArrowRight aria-hidden="true" size={18} /></PrimaryButton> : null}
      </div>
    </div>

    <div className={styles.jobGrid}>
      <section className={styles.surface} aria-labelledby="timeline-title">
        <header className={styles.sectionHeader}><div><h2 id="timeline-title">処理タイムライン</h2></div><span aria-live="polite">{stateLabel}</span></header>
        <ol className={styles.timeline}>{events.map((event) => <li data-tone={event.tone} key={event.id}><span className={styles.timelineDot} aria-hidden="true" /><div><strong>{event.label}</strong><p>{event.detail}</p></div><time>{event.at}</time></li>)}</ol>
      </section>
      <aside className={styles.jobMeta} aria-labelledby="job-detail-title">
        <h2 id="job-detail-title">処理の詳細</h2>
        <dl><div><dt>Job ID</dt><dd>…8F2A <button aria-label="Job IDをコピー" onClick={() => setCopied(true)} type="button"><Copy aria-hidden="true" size={15} /></button></dd></div><div><dt>音声</dt><dd>30分00秒</dd></div><div><dt>試行</dt><dd>{state === "retry_wait" ? "2 / 4" : "3 / 4"}</dd></div><div><dt>次の再試行</dt><dd>{state === "retry_wait" ? "14:15" : "—"}</dd></div></dl>
        {copied ? <p className={styles.copyStatus} role="status">Job IDをコピーしました。</p> : null}
        <p className={styles.safeError}><AlertCircle aria-hidden="true" size={17} /><span>一時的な失敗です。音声は保存済みです。</span></p>
      </aside>
    </div>
  </section>;
}

export function LaneAExperience({ kind }: { kind: ScreenKind }): ReactNode {
  switch (kind) {
    case "auth": return <LoginExperience />;
    case "dashboard": return <HomeExperience />;
    case "collection": return <VisitListExperience />;
    case "form": return <VisitFormExperience />;
    case "document": return <DocumentExperience />;
    case "recording": return <RecordingExperience />;
    case "job": return <JobExperience />;
    default: return null;
  }
}
